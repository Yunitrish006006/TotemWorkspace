import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAllowedInteraction, isAllowedMessage, loadConfig } from "../src/config.mjs";

const env = {
  DISCORD_BOT_TOKEN: "test-token",
  DISCORD_APPLICATION_ID: "123456789012345678",
  DISCORD_BRIDGE_APPLICATION_ID: "133456789012345678",
  DISCORD_GUILD_ID: "223456789012345678",
  DISCORD_ALLOWED_USER_IDS: "323456789012345678",
  DISCORD_ALLOWED_CHANNEL_IDS: "423456789012345678",
  CODEX_WORKSPACES_JSON: '{"nexus":"/workspace/TotemNexus"}',
  CODEX_WORKSPACE_ROOT: "/workspace"
};

test("configuration requires explicit user, channel and workspace allowlists", () => {
  const config = loadConfig(env);
  assert.deepEqual(config.workspaces.get("nexus"), { path: "/workspace/TotemNexus", allowNonGit: false });
  assert.deepEqual(config.workspaces.get("workspace"), { path: "/workspace", allowNonGit: true });
  assert.equal(config.maxRuntimeMs, 0);
  assert.equal(config.usageGuardMode, 'enforce');
  assert.equal(config.workloadScopeMode, 'auto');
  assert.equal(config.historyEnabled, false);
  assert.equal(config.goalsEnabled, false);
  assert.equal(config.historyOwnerUserId, null);
  assert.deepEqual(config.historyThreadGrants, []);
  const historyConfig = loadConfig({ ...env,
    CODEX_DISCORD_HISTORY_ENABLED: 'true',
    CODEX_DISCORD_GOALS_ENABLED: 'true',
    CODEX_HISTORY_OWNER_USER_ID: '323456789012345678',
    CODEX_HISTORY_THREAD_GRANTS_JSON: '[{"threadId":"thread-unknown","userId":"323456789012345678"}]'
  });
  assert.equal(historyConfig.historyEnabled, true);
  assert.equal(historyConfig.goalsEnabled, true);
  assert.equal(historyConfig.historyOwnerUserId, '323456789012345678');
  assert.deepEqual(historyConfig.historyThreadGrants, [{ threadId: 'thread-unknown', userId: '323456789012345678' }]);
  assert.throws(() => loadConfig({ ...env, CODEX_DISCORD_HISTORY_ENABLED: 'yes' }), /must be true or false/);
  assert.throws(() => loadConfig({ ...env, CODEX_HISTORY_OWNER_USER_ID: '999999999999999999' }), /in DISCORD_ALLOWED_USER_IDS/);
  assert.throws(() => loadConfig({ ...env, CODEX_HISTORY_THREAD_GRANTS_JSON: '[{"threadId":"x","userId":"999999999999999999"}]' }), /invalid or duplicate/);
  assert.throws(() => loadConfig({ ...env, CODEX_HISTORY_THREAD_GRANTS_JSON: '[{"threadId":"x","userId":"323456789012345678"},{"threadId":"x","userId":"323456789012345678"}]' }), /invalid or duplicate/);
  assert.equal(loadConfig({ ...env, CODEX_USAGE_GUARD_MODE: 'observe' }).usageGuardMode, 'observe');
  assert.equal(loadConfig({ ...env, CODEX_WORKLOAD_SCOPE_MODE: 'systemd' }).workloadScopeMode, 'systemd');
  assert.equal(loadConfig({ ...env, CODEX_WORKLOAD_SCOPE_MODE: 'direct' }).workloadScopeMode, 'direct');
  assert.throws(() => loadConfig({ ...env, CODEX_WORKLOAD_SCOPE_MODE: 'shell' }), /auto, systemd, or direct/);
  assert.throws(() => loadConfig({ ...env, CODEX_USAGE_GUARD_MODE: 'disabled' }), /must be enforce or observe/);
  assert.equal(loadConfig({ ...env, CODEX_MAX_RUNTIME_SECONDS: "0" }).maxRuntimeMs, 0);
  assert.equal(loadConfig({ ...env, CODEX_MAX_RUNTIME_SECONDS: "6000" }).maxRuntimeMs, 6_000_000);
  const sync = loadConfig({
    ...env,
    TOTEM_WORKSPACE_SYNC_URL: "http://127.0.0.1:18765/",
    TOTEM_WORKSPACE_SYNC_TOKEN: "test-private-sync-token",
    TOTEM_WORKSPACE_SYNC_CHANNEL_ID: "423456789012345678"
  }).workspaceSync;
  assert.deepEqual(sync, {
    url: "http://127.0.0.1:18765/",
    token: "test-private-sync-token",
    channelId: "423456789012345678",
    workspaceName: "workspace"
  });
  assert.throws(() => loadConfig({ ...env, DISCORD_ALLOWED_USER_IDS: "" }), /DISCORD_ALLOWED_USER_IDS is required/);
  assert.throws(() => loadConfig({ ...env, CODEX_WORKSPACES_JSON: '{"bad":"relative"}' }), /absolute path/);
  assert.throws(() => loadConfig({ ...env, DISCORD_GUILD_ID: "not-an-id" }), /snowflake/);
  assert.throws(
    () => loadConfig({ ...env, DISCORD_APPLICATION_ID: env.DISCORD_BRIDGE_APPLICATION_ID }),
    /different Application/
  );
  assert.throws(() => loadConfig({ ...env, CODEX_MAX_RUNTIME_SECONDS: "1" }), /0 \(unlimited\) or an integer from 30 to 7200/);
  assert.throws(() => loadConfig({ ...env, CODEX_MAX_RUNTIME_SECONDS: "7201" }), /0 \(unlimited\) or an integer from 30 to 7200/);
  assert.throws(() => loadConfig({ ...env, TOTEM_WORKSPACE_SYNC_URL: "https://example.com" }), /configured together/);
  assert.throws(() => loadConfig({
    ...env,
    TOTEM_WORKSPACE_SYNC_URL: "http://example.com",
    TOTEM_WORKSPACE_SYNC_TOKEN: "test-private-sync-token",
    TOTEM_WORKSPACE_SYNC_CHANNEL_ID: "423456789012345678"
  }), /loopback host/);
});

test("access requires both the configured user and channel", () => {
  const config = loadConfig(env);
  const allowed = { user: { id: "323456789012345678" }, channelId: "423456789012345678", channel: { parentId: null } };
  assert.equal(isAllowedInteraction(allowed, config), true);
  assert.equal(isAllowedInteraction({ ...allowed, user: { id: "999999999999999999" } }, config), false);
  assert.equal(isAllowedInteraction({ ...allowed, channelId: "999999999999999999" }, config), false);
  assert.equal(isAllowedInteraction({ ...allowed, channelId: "999999999999999999", channel: { parentId: "423456789012345678" } }, config), true);
  assert.equal(isAllowedMessage({ author: { id: "323456789012345678" }, channelId: "423456789012345678", channel: { parentId: null } }, config), true);
});

test("workspace root adds direct child Git repositories to the allow-listed selector", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-discord-workspaces-"));
  try {
    await mkdir(path.join(root, "TotemNewMod", ".git"), { recursive: true });
    await mkdir(path.join(root, "TotemLinkedWorktree"), { recursive: true });
    await writeFile(path.join(root, "TotemLinkedWorktree", ".git"), "gitdir: ../.git/worktrees/linked\n");
    await mkdir(path.join(root, "not-a-repo"), { recursive: true });
    await Promise.all(Array.from({ length: 26 }, (_, index) =>
      mkdir(path.join(root, `Repo-${index}`, ".git"), { recursive: true })));
    const config = loadConfig({ ...env, CODEX_WORKSPACE_ROOT: root });
    assert.deepEqual(config.workspaces.get("totem-new-mod"), {
      path: path.join(root, "TotemNewMod"), allowNonGit: false
    });
    assert.deepEqual(config.workspaces.get("totem-linked-worktree"), {
      path: path.join(root, "TotemLinkedWorktree"), allowNonGit: false
    });
    assert.equal(config.workspaces.has("not-a-repo"), false);
    assert.ok(config.workspaces.size > 25, "autocomplete can serve repositories beyond Discord's per-response choice limit");
    assert.deepEqual(config.workspaces.get("nexus"), {
      path: "/workspace/TotemNexus", allowNonGit: false
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
