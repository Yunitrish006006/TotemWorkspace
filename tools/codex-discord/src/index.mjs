import { mkdir } from "node:fs/promises";
import { loadConfig } from "./config.mjs";
import { SessionStore } from "./session-store.mjs";
import { CodexRunner } from "./codex-runner.mjs";
import { registerCommands, startBot } from "./bot.mjs";
import { createWorkloadSpawner } from "../../../intelligence/agent-runtime/process-scope.mjs";
import { spawnGoalClient, spawnThreadClient } from "../../../intelligence/agent-runtime/thread-client.mjs";
import { ThreadOwnershipStore } from "./thread-ownership.mjs";
import { createHistoryAccess } from "./history-access.mjs";

const config = loadConfig();
await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
const sessions = new SessionStore(config.stateDir);
await sessions.load();
const ownership = await new ThreadOwnershipStore(config.stateDir).load();
const historyAccess = config.historyEnabled ? createHistoryAccess({ config, ownership }) : null;
const spawnImpl = createWorkloadSpawner({ mode: config.workloadScopeMode });
const runner = new CodexRunner({ stateDir: config.stateDir, maxRuntimeMs: config.maxRuntimeMs, usageGuardMode: config.usageGuardMode, spawnImpl });
const catalogWorkspace = config.workspaces.values().next().value;
const models = await runner.listModels({ workspace: catalogWorkspace.path });
if (models.length === 0) throw new Error("Codex did not report any picker-visible models for this login");
await registerCommands(config);
await startBot({
  config,
  sessions,
  runner,
  models,
  ownership,
  historyAccess,
  historyClientFactory: async ({ cwd }) => {
    const client = spawnThreadClient({ cwd });
    await client.start();
    return client;
  },
  goalClientFactory: async ({ cwd }) => {
    const client = spawnGoalClient({ cwd });
    await client.start();
    return client;
  }
});
