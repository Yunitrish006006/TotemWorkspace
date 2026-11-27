import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sessionKey, SessionStore, taskKey } from "../src/session-store.mjs";

test("active task locks span Discord threads without merging saved sessions", () => {
  assert.equal(
    taskKey({ userId: "user", channelId: "thread-a", workspace: "core" }),
    taskKey({ userId: "user", channelId: "thread-b", workspace: "core" })
  );
  assert.notEqual(taskKey({ userId: "user", workspace: "core" }), taskKey({ userId: "user", workspace: "nexus" }));
  assert.notEqual(
    sessionKey({ userId: "user", channelId: "thread-a", workspace: "core" }),
    sessionKey({ userId: "user", channelId: "thread-b", workspace: "core" })
  );
});

test("the selected reasoning depth survives a bot restart", async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), "codex-discord-session-"));
  try {
    const first = new SessionStore(stateDir);
    await first.load();
    await first.setActiveModel("user:channel", "gpt-5.6-sol");
    await first.setActiveReasoningEffort("user:channel", "high");
    await first.setProgressLineCount("user:channel", 7);

    const restarted = new SessionStore(stateDir);
    await restarted.load();
    assert.equal(restarted.activeModel("user:channel"), "gpt-5.6-sol");
    assert.equal(restarted.activeReasoningEffort("user:channel"), "high");
    assert.equal(restarted.progressLineCount("user:channel"), 7);

    await restarted.setActiveReasoningEffort("user:channel", null);
    assert.equal(restarted.activeReasoningEffort("user:channel"), null);
    await assert.rejects(() => restarted.setProgressLineCount("user:channel", 9), /0 to 8/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("usage checkpoints are bounded, idempotent and survive restart without prompt content", async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), "codex-discord-checkpoint-"));
  try {
    const key = "user:channel:workspace";
    const first = new SessionStore(stateDir);
    await first.load();
    await first.set(key, { sessionId: "thread-1", workspace: "workspace", updatedAt: "now" });
    const value = { id: "thread-1:turn-1", sessionId: "thread-1", workspace: "workspace",
      branch: "feature/checkpoint", head: "a".repeat(40),
      worktreeDigest: "c".repeat(64),
      filesChanged: ["src/A.mjs", "../private", "/absolute/private"],
      usage: { observedToolCalls: 40, peakContext: 48000 }, prompt: "private prompt" };
    assert.equal(await first.setCheckpoint(key, value), true);
    assert.equal(await first.setCheckpoint(key, { ...value, prompt: "different secret" }), false);
    assert.deepEqual(first.checkpoint(key).filesChanged, ["src/A.mjs"]);
    assert.equal(first.checkpoint(key).usage.peakContext, 48000);
    assert.equal(first.checkpoint(key).worktreeDigest, "c".repeat(64));
    assert.equal(first.checkpoint(key).usage.threadInputTokens, null);
    assert.ok(!JSON.stringify(first.checkpoint(key)).includes("private prompt"));
    assert.equal(await first.setCheckpoint(key, { ...value,
      filesChanged: ["src/A.mjs", "src/B.mjs"], usage: { action: "stop", observedToolCalls: 80, peakContext: 64000 } }), true);
    assert.equal(first.checkpoint(key).state, "stopped");
    assert.deepEqual(first.checkpoint(key).filesChanged, ["src/A.mjs", "src/B.mjs"]);
    assert.equal(first.checkpoint(key).usage.observedToolCalls, 80);
    assert.equal(await first.setCheckpoint(key, { ...value,
      usage: { action: "stop", observedToolCalls: 81, peakContext: 64000 } }), false);

    const restarted = new SessionStore(stateDir);
    await restarted.load();
    assert.equal(restarted.checkpoint(key).id, "thread-1:turn-1");
    assert.equal(restarted.checkpoint(key).state, "stopped");
    assert.deepEqual(restarted.checkpoint(key).remainingRisks,
      ["Runtime turn stopped before completing the requested task."]);
    assert.equal(await restarted.clearCheckpoint(key, "other-thread"), false);
    assert.equal(restarted.checkpoint(key).id, "thread-1:turn-1");
    assert.equal(await restarted.clearCheckpoint(key, "thread-1"), true);
    assert.equal(restarted.checkpoint(key), null);
    assert.equal(await restarted.setCheckpoint(key, value), true);
    await restarted.set(key, { sessionId: "thread-2", workspace: "workspace", updatedAt: "later" });
    assert.equal(restarted.checkpoint(key), null, "a replacement session must not inherit stale recovery state");
    await restarted.delete(key);
    assert.equal(restarted.checkpoint(key), null);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("concurrent checkpoint and stop saves are serialized with the newest state persisted", async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), "codex-discord-checkpoint-race-"));
  try {
    const key = "user:channel:workspace";
    const store = new SessionStore(stateDir);
    await store.load();
    await store.set(key, { sessionId: "thread-race", workspace: "workspace" });
    const base = { id: "thread-race:turn-race", sessionId: "thread-race", workspace: "workspace",
      branch: "feature/race", head: "b".repeat(40), filesChanged: ["src/Race.mjs"] };
    await Promise.all([
      store.setCheckpoint(key, { ...base, usage: { action: "checkpoint", observedToolCalls: 40 } }),
      store.setCheckpoint(key, { ...base, usage: { action: "stop", observedToolCalls: 80 } })
    ]);
    const restarted = new SessionStore(stateDir);
    await restarted.load();
    assert.equal(restarted.checkpoint(key).state, "stopped");
    assert.equal(restarted.checkpoint(key).usage.observedToolCalls, 80);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('legacy sessions migrate without losing channel settings or checkpoint data', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'codex-discord-session-migration-'));
  try {
    const key = '12345678901234567:22345678901234567:workspace';
    const legacy = { sessions: { [key]: { sessionId: 'legacy-thread', workspace: 'workspace', updatedAt: '2026-01-01T00:00:00.000Z',
      checkpoint: { id: 'legacy:turn', sessionId: 'legacy-thread', workspace: 'workspace', usage: { peakContext: 99 } } } },
      activeModels: { '12345678901234567:22345678901234567': 'gpt-5.6-sol' },
      activeReasoningEfforts: { '12345678901234567:22345678901234567': 'high' },
      progressLineCounts: { '12345678901234567:22345678901234567': 4 } };
    await writeFile(path.join(stateDir, 'sessions.json'), JSON.stringify(legacy));
    const store = new SessionStore(stateDir);
    await store.load();
    assert.deepEqual({ sessionId: store.get(key).sessionId, workspace: store.get(key).workspace,
      origin: store.get(key).origin, checkpoint: store.checkpoint(key).id },
    { sessionId: 'legacy-thread', workspace: 'workspace', origin: 'discord', checkpoint: 'legacy:turn' });
    assert.equal(store.activeModel('12345678901234567:22345678901234567'), 'gpt-5.6-sol');
    assert.equal(store.activeReasoningEffort('12345678901234567:22345678901234567'), 'high');
    assert.equal(store.progressLineCount('12345678901234567:22345678901234567'), 4);
    await store.setActiveModel('preserve:migration', null);
    const saved = JSON.parse(await readFile(path.join(stateDir, 'sessions.json'), 'utf8'));
    assert.equal(saved.schemaVersion, 2);
    assert.equal(saved.sessions[key].selectionRevision, 0);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

test('pending history selection persists across restart, uses CAS, and blocks execution/reset while busy', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'codex-discord-pending-binding-'));
  try {
    const key = '12345678901234567:22345678901234567:workspace';
    const selection = { workspace: 'workspace', source: 'vscode', sourceThreadId: 'native-thread',
      sourceLastCompletedTurnId: 'turn-7', expectedRevision: 0 };
    const store = new SessionStore(stateDir);
    await store.load();
    const pending = await store.setPendingSelection(key, selection);
    assert.equal(pending.sessionId, null);
    assert.equal(pending.origin, 'native-selection');
    assert.equal(pending.selectionMode, 'fork');
    assert.equal(pending.selectionRevision, 1);
    await assert.rejects(store.beginRun(key), error => error.code === 'SESSION_SELECTION_PENDING');
    await assert.rejects(store.setPendingSelection(key, selection), error => error.code === 'SESSION_BINDING_CONFLICT');

    const restarted = new SessionStore(stateDir);
    await restarted.load();
    assert.equal(restarted.get(key).sourceThreadId, 'native-thread');
    assert.equal(restarted.get(key).sourceLastCompletedTurnId, 'turn-7');
    assert.equal(restarted.bindingRevision(key), 1);
    const lease = await restarted.beginRun('other-channel-binding', 'same-user-workspace');
    await assert.rejects(restarted.setPendingSelection('another-channel-binding', { ...selection,
      expectedRevision: 0, workspaceRunKey: 'same-user-workspace' }), error => error.code === 'SESSION_BINDING_BUSY');
    await assert.rejects(restarted.delete('another-channel-binding', 'same-user-workspace'),
      error => error.code === 'SESSION_BINDING_BUSY');
    assert.equal(await restarted.endRun('other-channel-binding', lease, 'same-user-workspace'), true);
    assert.equal(await restarted.delete(key), true);
    assert.equal(restarted.bindingRevision(key), 2);
    await assert.rejects(restarted.beginRun(key, 'same-user-workspace', 1),
      error => error.code === 'SESSION_BINDING_CONFLICT');
    await assert.rejects(restarted.setPendingSelection(key, { ...selection, expectedRevision: 1 }),
      error => error.code === 'SESSION_BINDING_CONFLICT');
    assert.equal((await restarted.setPendingSelection(key, { ...selection, expectedRevision: 2 })).selectionRevision, 3);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

test('fork lineage survives restart and malformed native-fork bindings fail closed', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'codex-discord-fork-lineage-'));
  try {
    const key = '12345678901234567:22345678901234567:workspace';
    const store = new SessionStore(stateDir);
    await store.load();
    await store.set(key, { sessionId: 'fork-thread', workspace: 'workspace', origin: 'native-fork',
      sourceThreadId: 'source-thread', sourceLastCompletedTurnId: 'turn-9', sourceUpdatedAt: 42,
      forkGoalPrepared: false });
    assert.equal(store.get(key).forkGoalPrepared, false);
    await store.set(key, { sessionId: 'fork-thread', workspace: 'workspace', origin: 'native-fork',
      sourceThreadId: 'source-thread', sourceLastCompletedTurnId: 'turn-9', sourceUpdatedAt: 42,
      forkGoalPrepared: true });
    const restarted = new SessionStore(stateDir);
    await restarted.load();
    assert.equal(restarted.get(key).origin, 'native-fork');
    assert.equal(restarted.get(key).sourceThreadId, 'source-thread');
    assert.equal(restarted.get(key).sourceLastCompletedTurnId, 'turn-9');
    assert.equal(restarted.get(key).sourceUpdatedAt, 42);
    assert.equal(restarted.get(key).forkGoalPrepared, true);
    await assert.rejects(restarted.set('bad-binding', { sessionId: 'source-thread', workspace: 'workspace',
      origin: 'native-fork', sourceThreadId: 'source-thread', sourceLastCompletedTurnId: 'turn-9' }));
    await writeFile(path.join(stateDir, 'sessions.json'), JSON.stringify({ sessions: { broken: {
      schemaVersion: 2, sessionId: 'fork-thread', workspace: 'workspace', origin: 'native-fork'
    } } }));
    await assert.rejects(new SessionStore(stateDir).load(), /cannot be loaded safely/);
    await writeFile(path.join(stateDir, 'sessions.json'), JSON.stringify({ sessions: { broken: {
      schemaVersion: 2, sessionId: 'source-thread', workspace: 'workspace', origin: 'native-fork',
      sourceThreadId: 'source-thread', sourceLastCompletedTurnId: 'turn-9'
    } } }));
    await assert.rejects(new SessionStore(stateDir).load(), /cannot be loaded safely/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('concurrent selections with one observed revision commit at most once', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'codex-discord-binding-cas-'));
  try {
    const store = new SessionStore(stateDir);
    await store.load();
    const base = { workspace: 'workspace', source: 'cli', sourceThreadId: 'thread-cas',
      sourceLastCompletedTurnId: 'turn-cas', expectedRevision: 0 };
    const outcomes = await Promise.allSettled([
      store.setPendingSelection('same-binding', base),
      store.setPendingSelection('same-binding', { ...base, sourceThreadId: 'thread-other' })
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(result => result.status === 'rejected'
      && result.reason.code === 'SESSION_BINDING_CONFLICT').length, 1);
    assert.equal(store.bindingRevision('same-binding'), 1);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

test('a concurrent first run and selection on one binding cannot both win', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'codex-discord-select-run-race-'));
  try {
    const store = new SessionStore(stateDir);
    await store.load();
    const bindingKey = 'user:channel:workspace', workspaceRunKey = 'user:workspace';
    const run = store.beginRun(bindingKey, workspaceRunKey, 0);
    const select = store.setPendingSelection(bindingKey, { workspace: 'workspace', source: 'cli',
      sourceThreadId: 'race-thread', sourceLastCompletedTurnId: 'race-turn', expectedRevision: 0,
      workspaceRunKey });
    const outcomes = await Promise.allSettled([run, select]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = outcomes.find(result => result.status === 'rejected');
    assert.ok(['SESSION_BINDING_CONFLICT', 'SESSION_BINDING_BUSY'].includes(rejected.reason.code));
    if (outcomes[0].status === 'fulfilled') await store.endRun(bindingKey, outcomes[0].value, workspaceRunKey);
    assert.ok(store.get(bindingKey)?.origin === 'native-selection' || !store.get(bindingKey));
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

test('a completed run changes the workspace epoch and invalidates history candidates captured before it', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'codex-discord-run-epoch-'));
  try {
    const store = new SessionStore(stateDir);
    await store.load();
    const workspaceRunKey = 'user:workspace';
    const oldEpoch = store.runEpoch(workspaceRunKey);
    const lease = await store.beginRun('user:channel:workspace', workspaceRunKey, 0, oldEpoch);
    assert.equal(store.runEpoch(workspaceRunKey), oldEpoch + 1);
    await store.endRun('user:channel:workspace', lease, workspaceRunKey);
    assert.equal(store.runEpoch(workspaceRunKey), oldEpoch + 2);
    await assert.rejects(store.setPendingSelection('user:other-channel:workspace', {
      workspace: 'workspace', source: 'cli', sourceThreadId: 'thread-epoch',
      sourceLastCompletedTurnId: 'turn-epoch', expectedRevision: 0,
      expectedRunEpoch: oldEpoch, workspaceRunKey
    }), error => error.code === 'SESSION_BINDING_CONFLICT');
    assert.equal((await store.setPendingSelection('user:other-channel:workspace', {
      workspace: 'workspace', source: 'cli', sourceThreadId: 'thread-epoch',
      sourceLastCompletedTurnId: 'turn-epoch', expectedRevision: 0,
      expectedRunEpoch: store.runEpoch(workspaceRunKey), workspaceRunKey
    })).selectionRevision, 1);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

test('a lease from before Bot restart cannot release the replacement process lease', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'codex-discord-restart-lease-'));
  try {
    const key = 'user:channel:workspace';
    const workspaceRunKey = 'user:workspace';
    const beforeRestart = new SessionStore(stateDir);
    await beforeRestart.load();
    const oldLease = await beforeRestart.beginRun(key, workspaceRunKey);

    const afterRestart = new SessionStore(stateDir);
    await afterRestart.load();
    const replacementLease = await afterRestart.beginRun(key, workspaceRunKey);
    assert.notEqual(replacementLease, oldLease);
    assert.equal(await afterRestart.endRun(key, oldLease, workspaceRunKey), false,
      'a delayed close callback from the previous process has no authority over the new lease');
    await assert.rejects(afterRestart.beginRun(key, workspaceRunKey), error => error.code === 'SESSION_BINDING_BUSY');
    assert.equal(await afterRestart.endRun(key, replacementLease, workspaceRunKey), true);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

test('failed pending-binding persistence rolls back the in-memory selection', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'codex-discord-binding-write-failure-'));
  try {
    const store = new SessionStore(stateDir);
    await store.load();
    await mkdir(path.join(stateDir, `sessions.json.${process.pid}.tmp`));
    await assert.rejects(store.setPendingSelection('same-binding', { workspace: 'workspace', source: 'cli',
      sourceThreadId: 'thread-write', sourceLastCompletedTurnId: 'turn-write', expectedRevision: 0 }));
    assert.equal(store.get('same-binding'), null);
    assert.equal(store.bindingRevision('same-binding'), 0);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});
