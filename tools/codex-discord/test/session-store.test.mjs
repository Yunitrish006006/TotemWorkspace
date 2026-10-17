import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
