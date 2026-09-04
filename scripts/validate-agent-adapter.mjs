#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { createAgentAdapter } from "../intelligence/agent-adapter.mjs";

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "totem-agent-adapter-"));
const workspaceRoot = path.join(root, "TotemWorkspace");
const reposRoot = root;
const alchemyRoot = path.join(root, "TotemAlchemy");
fs.mkdirSync(workspaceRoot, { recursive: true });
fs.mkdirSync(path.join(alchemyRoot, "src", "main", "java", "example"), { recursive: true });

const knowledge = {
  modules: [
    { id: "totem-alchemy", repoName: "TotemAlchemy" }
  ]
};

try {
  const off = createAgentAdapter({
    workspaceRoot,
    reposRoot,
    knowledge,
    env: { TOTEM_AGENT_ADAPTER: "off" },
    spawnSyncImpl() {
      throw new Error("disabled adapter must not probe Codex");
    }
  });
  assert.equal(off.status().configured, false);
  assert.equal(off.status().available, false);
  assert.match(off.status().reason, /disabled/);
  assert.throws(() => off.dispatch({ prompt: "do work" }), (error) => error.code === "ADAPTER_UNAVAILABLE");

  const activity = [];
  const settled = [];
  const spawned = [];
  let child = fakeChild();
  let stdin = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk) => {
    stdin += chunk;
  });

  const adapter = createAgentAdapter({
    workspaceRoot,
    reposRoot,
    knowledge,
    env: {
      TOTEM_AGENT_ADAPTER: "codex",
      TOTEM_CODEX_BIN: "codex-fixture",
      TOTEM_CODEX_CWD: reposRoot,
      TOTEM_CODEX_SANDBOX: "workspace-write",
      TOTEM_CODEX_MODEL: "fixture-model"
    },
    spawnSyncImpl(command, args, options) {
      assert.equal(command, "codex-fixture");
      assert.deepEqual(args, ["--version"]);
      assert.equal(options.cwd, reposRoot);
      return { status: 0, stdout: "codex-cli 0.fixture\n", stderr: "" };
    },
    spawnImpl(command, args, options) {
      spawned.push({ command, args, options });
      return child;
    },
    onActivity(event) {
      activity.push(event);
      return event;
    },
    async onTaskSettled(task) {
      settled.push(task);
    }
  });

  assert.equal(adapter.status().configured, true);
  assert.equal(adapter.status().available, true);
  assert.equal(adapter.status().busy, false);
  assert.match(adapter.status().version, /codex-cli/);

  const orchestrationPlan = {
    schemaVersion: 1,
    mode: "bounded-parallel",
    score: 7,
    estimatedBenefit: "high",
    assignments: [
      {
        id: "explorer:scope",
        role: "explorer",
        modules: ["totem-alchemy"],
        phase: "discovery",
        dependsOn: [],
        writeAllowed: false,
        contextAudience: "explorer",
        maxContextTokens: 6000,
        purpose: "Confirm brewing implementation scope."
      },
      {
        id: "worker:totem-alchemy",
        role: "worker",
        modules: ["totem-alchemy"],
        phase: "implementation",
        dependsOn: ["explorer:scope"],
        writeAllowed: true,
        contextAudience: "worker",
        maxContextTokens: 9000,
        purpose: "Implement the bounded Alchemy change."
      }
    ],
    executionWaves: [
      { phase: "discovery", parallel: true, assignments: ["explorer:scope"] },
      { phase: "implementation", parallel: false, assignments: ["worker:totem-alchemy"] }
    ],
    rationale: {
      modules: ["totem-alchemy"],
      contractIds: [],
      criticalContractIds: [],
      risks: [],
      highRisks: [],
      validationCategories: ["build"],
      requiresIndependentReview: true
    },
    limits: {
      maxSubagents: 4,
      recommendedSubagents: 2,
      maxParallelWorkers: 1,
      duplicateRepositoryReads: "avoid",
      workerWriteScope: "module-bounded"
    },
    fallback: {
      whenMultiAgentUnavailable: "execute sequentially",
      smallTaskRule: "primary-only plans must not spawn subagents"
    }
  };
  const task = adapter.dispatch({
    prompt: "Fix the brewing flow and validate it.",
    moduleId: "totem-alchemy",
    featureId: "totem-alchemy.feature-1",
    orchestrationPlan
  });
  assert.equal(task.state, "running");
  assert.equal(task.adapter, "codex");
  assert.equal(task.orchestration?.mode, "bounded-parallel");
  assert.equal(task.orchestration?.subagents, 2);
  assert.equal(adapter.status().busy, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, "codex-fixture");
  assert.deepEqual(spawned[0].args, [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--cd",
    reposRoot,
    "--model",
    "fixture-model",
    "-"
  ]);
  assert.equal(spawned[0].options.cwd, reposRoot);
  assert.ok(!spawned[0].args.includes("--full-auto"));
  assert.ok(!spawned[0].args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.throws(
    () => adapter.dispatch({ prompt: "second task" }),
    (error) => error.code === "AGENT_BUSY"
  );

  await tick();
  assert.match(stdin, /TotemWorkspace local Codex agent adapter/);
  assert.match(stdin, /Semantic module focus: totem-alchemy/);
  assert.match(stdin, /TotemWorkspace adaptive orchestration plan/);
  assert.match(stdin, /Mode: bounded-parallel; score: 7/);
  assert.match(stdin, /Assignment explorer:scope/);
  assert.match(stdin, /must not spawn further subagents/);
  assert.match(stdin, /Do not spawn any subagent for a primary-only plan/);
  assert.match(stdin, /Fix the brewing flow/);

  child.stdout.write('{"type":"thread.started","thread_id":"thread-fixture"}\n');
  child.stdout.write(JSON.stringify({
    type: "item.started",
    item: {
      id: "mcp-1",
      type: "mcp_tool_call",
      server: "totemWorkspace",
      tool: "context_pack",
      status: "in_progress"
    }
  }) + "\n");
  child.stdout.write(JSON.stringify({
    type: "item.completed",
    item: {
      id: "file-1",
      type: "file_change",
      changes: [
        {
          path: path.join(alchemyRoot, "src", "main", "java", "example", "Brewing.java"),
          kind: "update"
        }
      ],
      status: "completed"
    }
  }) + "\n");
  child.stdout.write(JSON.stringify({
    type: "item.completed",
    item: {
      id: "command-commit",
      type: "command_execution",
      command: "git commit -m \"replay fixture\"",
      aggregated_output: "[main abc1234] replay fixture",
      exit_code: 0,
      status: "completed"
    }
  }) + "\n");
  child.stdout.write(JSON.stringify({
    type: "item.completed",
    item: {
      id: "command-pr",
      type: "command_execution",
      command: "gh pr create --title \"fixture\"",
      aggregated_output: "https://github.com/example/repo/pull/1",
      exit_code: 0,
      status: "completed"
    }
  }) + "\n");
  child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":3,"reasoning_output_tokens":1}}\n');

  await tick();
  await tick();

  const completedStatus = adapter.status();
  assert.equal(completedStatus.busy, false);
  assert.equal(completedStatus.lastTask?.state, "completed");
  assert.equal(completedStatus.lastTask?.threadId, "thread-fixture");
  assert.equal(settled.length, 1);
  assert.equal(settled[0].state, "completed");
  assert.ok(activity.some((event) => event.type === "task_started" && event.taskId === task.id));
  assert.ok(activity.some((event) => event.type === "dependency_followed" && /context_pack/.test(event.summary)));
  const fileEdit = activity.find((event) => event.type === "file_edit");
  assert.ok(fileEdit, "Codex file_change must become file_edit activity");
  assert.equal(fileEdit.moduleId, "totem-alchemy");
  assert.equal(fileEdit.file, "src/main/java/example/Brewing.java");
  assert.ok(!fileEdit.file.includes(root), "activity must never expose absolute workspace paths");
  assert.ok(activity.some((event) => event.type === "commit_created" && event.taskId === task.id));
  assert.ok(activity.some((event) => event.type === "pr_created" && event.taskId === task.id));
  assert.ok(activity.some((event) => event.type === "task_completed" && event.taskId === task.id));

  child.emit("close", 0, null);
  await tick();
  assert.equal(settled.length, 1, "process close after turn.completed must not settle twice");

  child = fakeChild();
  const failing = createAgentAdapter({
    workspaceRoot,
    reposRoot,
    knowledge,
    env: {
      TOTEM_AGENT_ADAPTER: "codex",
      TOTEM_CODEX_CWD: reposRoot
    },
    spawnSyncImpl() {
      return { status: 0, stdout: "codex-cli fixture\n", stderr: "" };
    },
    spawnImpl() {
      return child;
    },
    onActivity(event) {
      activity.push(event);
    },
    async onTaskSettled(taskValue) {
      settled.push(taskValue);
    }
  });
  const failedTask = failing.dispatch({ prompt: "Fail fixture" });
  child.stdout.write('{"type":"turn.failed","error":{"message":"fixture failure"}}\n');
  await tick();
  await tick();
  assert.equal(failing.status().lastTask?.state, "failed");
  assert.match(failing.status().lastTask?.error ?? "", /fixture failure/);
  assert.ok(activity.some((event) => event.type === "task_failed" && event.taskId === failedTask.id));

  child = fakeChild();
  const interrupted = createAgentAdapter({
    workspaceRoot,
    reposRoot,
    knowledge,
    env: {
      TOTEM_AGENT_ADAPTER: "codex",
      TOTEM_CODEX_CWD: reposRoot
    },
    spawnSyncImpl() {
      return { status: 0, stdout: "codex-cli fixture\n", stderr: "" };
    },
    spawnImpl() {
      return child;
    },
    onActivity(event) {
      activity.push(event);
    },
    async onTaskSettled(taskValue) {
      settled.push(taskValue);
    }
  });
  const interruptedTask = interrupted.dispatch({ prompt: "Long running fixture" });
  assert.equal(interrupted.status().busy, true);
  interrupted.close("Bridge restart interrupted active task");
  await tick();
  assert.equal(child.killed, true);
  assert.equal(interrupted.status().busy, false);
  assert.equal(interrupted.status().lastTask?.state, "failed");
  assert.match(interrupted.status().lastTask?.error ?? "", /Bridge restart interrupted active task/);
  assert.ok(activity.some((event) =>
    event.type === "task_failed" &&
    event.taskId === interruptedTask.id &&
    /Bridge restart interrupted active task/.test(event.summary)
  ));

  const unsafe = createAgentAdapter({
    workspaceRoot,
    reposRoot,
    knowledge,
    env: {
      TOTEM_AGENT_ADAPTER: "codex",
      TOTEM_CODEX_CWD: path.dirname(root)
    },
    spawnSyncImpl() {
      throw new Error("unsafe cwd must fail before Codex probe");
    }
  });
  assert.equal(unsafe.status().available, false);
  assert.match(unsafe.status().reason ?? "", /cwd must stay inside/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const adapterSource = fs.readFileSync(new URL("../intelligence/agent-adapter.mjs", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("./serve-local-viewer.mjs", import.meta.url), "utf8");
const flutterLive = fs.readFileSync(new URL("../viewer_flutter/lib/live/workspace_live.dart", import.meta.url), "utf8");
const flutterHost = fs.readFileSync(new URL("../viewer_flutter/lib/widgets/workspace_graph_host.dart", import.meta.url), "utf8");
const legacyLive = fs.readFileSync(new URL("../viewer/local-live.js", import.meta.url), "utf8");
const legacyHtml = fs.readFileSync(new URL("../graph-v2.html", import.meta.url), "utf8");

for (const fragment of [
  'TOTEM_AGENT_ADAPTER',
  '["exec", "--json", "--skip-git-repo-check", "--sandbox", sandbox, "--cd", codexCwd]',
  'args.push("-")',
  'child.stdin?.end?.(promptEnvelope',
  'item.type === "file_change"',
  'item.type === "mcp_tool_call"',
  'item.type === "command_execution"',
  '"commit_created"',
  '"pr_created"',
  '"pr_merged"',
  'type: finalState === "completed" ? "task_completed" : "task_failed"',
  'function close(reason = "Bridge shutdown interrupted active task")',
  'void settle(task, "failed", reason)',
]) {
  assert.ok(adapterSource.includes(fragment), `Codex adapter core missing: ${fragment}`);
}
assert.ok(!adapterSource.includes("--dangerously-bypass-approvals-and-sandbox"), "adapter must not force dangerous Codex bypass");
assert.ok(!adapterSource.includes("--full-auto"), "adapter must not force Codex full-auto approval changes");

for (const fragment of [
  '"task_failed"',
  'pathname === "/api/agent-adapter"',
  'agentAdapter.dispatch({',
  'execution: "agent-adapter-unavailable"',
  'execution: "codex"',
  'onTaskSettled: async (task) =>',
  'refreshWorkspaceChanges([], { taskId: task?.id ?? null })',
  'server.totemShutdown = (reason = "Bridge shutdown interrupted active Codex task") =>',
  'agentAdapter?.close?.(reason)',
  'server.totemShutdown?.(`Bridge received ${signal}; active Codex task interrupted`)',
  'process.once(signal, () => shutdown(signal))',
]) {
  assert.ok(serverSource.includes(fragment), `Bridge Phase 5 integration missing: ${fragment}`);
}

for (const fragment of [
  "class AgentAdapterStatus",
  "class AgentTask",
  "class PromptSubmission",
  "Future<AgentAdapterStatus> agentAdapterStatus()",
  "Future<PromptSubmission> submitPrompt(",
]) {
  assert.ok(flutterLive.includes(fragment), `Flutter Phase 5 client missing: ${fragment}`);
}
for (const fragment of [
  "_AgentAdapterStrip(",
  "replaySession: _replayTimeline?.sessions.isNotEmpty == true",
  "'INTERRUPTED'",
  "client.agentAdapterStatus()",
  "if (submission.adapter != null) _adapter = submission.adapter",
]) {
  assert.ok(flutterHost.includes(fragment), `Flutter Phase 5 host missing: ${fragment}`);
}
for (const fragment of [
  'document.getElementById("agentAdapter")',
  'fetch(apiUrl("/api/agent-adapter")',
  'payload.execution === "agent-adapter-unavailable"',
  'latestAdapterStatus',
  'replaySession.state === "running" ? "INTERRUPTED"',
]) {
  assert.ok(legacyLive.includes(fragment), `legacy Phase 5 live adapter missing: ${fragment}`);
}
assert.ok(!flutterHost.includes("_liveError = submission.execution == 'agent-adapter-unavailable'"), "expected adapter-unavailable state must stay in the adapter strip instead of becoming a generic Local API warning");
assert.ok(legacyHtml.includes('id="agentAdapter"'), "legacy Agent Adapter badge is required");

console.log("Phase 5 agent-adapter validation passed: opt-in Codex exec JSONL dispatch, safe argv/stdin boundary, single-task gate, lifecycle/file/MCP event mapping, failure semantics, and Flutter/legacy adapter status parity are present.");
