import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { orchestrationPlanSummary } from "./orchestration-plan.mjs";
import { probeCodexRuntime } from "./codex-runtime-probe.mjs";
import { resolveModelPolicy } from "./model-policy.mjs";
import { CodexRunner } from "./agent-runtime/runtime.mjs";
import { normalizeAppServerEvent } from "./agent-runtime/activity-adapter.mjs";
import { buildOrchestrationPlan } from "./orchestration-plan.mjs";
import { buildContextPack } from "./context-pack.mjs";
import { constrainedWriteRoots, executionWorkspace } from "./agent-runtime/orchestration-context.mjs";
import { buildDeveloperInstructions } from "./agent-runtime/runtime-policy.mjs";

const ADAPTER_SCHEMA_VERSION = 1;
const TASK_SCHEMA_VERSION = 1;
const ALLOWED_SANDBOXES = new Set(["read-only", "workspace-write"]);

function boundedText(value, limit = 500) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length <= limit ? text : text.slice(0, limit);
}

function isInside(base, target) {
  const relative = path.relative(base, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeWorkspaceCwd(value, { workspaceRoot, reposRoot }) {
  const resolved = path.resolve(value || reposRoot);
  if (!isInside(reposRoot, resolved) && !isInside(workspaceRoot, resolved)) {
    throw new Error("Codex adapter cwd must stay inside the Totem workspace");
  }
  return resolved;
}

function sanitizeMessage(value, { workspaceRoot, reposRoot }) {
  let text = boundedText(value, 500) ?? "";
  for (const root of [workspaceRoot, reposRoot]) {
    if (!root) continue;
    text = text.split(root).join("<workspace>");
  }
  return text;
}

function nowIso() {
  return new Date().toISOString();
}

function publicTask(task) {
  if (!task) return null;
  return Object.freeze({
    schemaVersion: TASK_SCHEMA_VERSION,
    id: task.id,
    adapter: task.adapter,
    state: task.state,
    moduleId: task.moduleId ?? null,
    featureId: task.featureId ?? null,
    threadId: task.threadId ?? null,
    startedAt: task.startedAt,
    completedAt: task.completedAt ?? null,
    summary: task.summary ?? null,
    error: task.error ?? null,
    finalMessage: task.finalMessage ?? null,
    usage: task.usage ?? null,
    chosenModel: task.chosenModel ?? null,
    orchestration: task.orchestration ?? null
  });
}

function moduleFileFor(rawPath, { cwd, workspaceRoot, reposRoot, knowledge }) {
  if (!rawPath) return null;
  const normalized = String(rawPath).replaceAll("\\", "/");
  const absolute = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(cwd, normalized);

  for (const module of knowledge?.modules ?? []) {
    const repoPath = path.resolve(reposRoot, module.repoName);
    if (!isInside(repoPath, absolute)) continue;
    const relative = path.relative(repoPath, absolute).replaceAll("\\", "/");
    if (!relative || relative.startsWith("../")) return null;
    return Object.freeze({
      moduleId: module.id,
      repoName: module.repoName,
      file: relative
    });
  }

  if (isInside(workspaceRoot, absolute)) {
    const relative = path.relative(workspaceRoot, absolute).replaceAll("\\", "/");
    if (!relative || relative.startsWith("../")) return null;
    return Object.freeze({
      moduleId: null,
      repoName: "TotemWorkspace",
      file: relative
    });
  }
  return null;
}

function eventItem(event) {
  if (!event || typeof event !== "object") return null;
  if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") return null;
  return event.item && typeof event.item === "object" ? event.item : null;
}

function jsonDetail(value, limit = 6000) {
  if (value == null) return null;
  let text;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return boundedText(text, limit);
}

function normalizedUsage(raw = {}) {
  const number = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const usage = {
    inputTokens: number(raw.input_tokens ?? raw.inputTokens),
    cachedInputTokens: number(raw.cached_input_tokens ?? raw.cachedInputTokens),
    cacheWriteInputTokens: number(raw.cache_write_input_tokens ?? raw.cacheWriteInputTokens),
    outputTokens: number(raw.output_tokens ?? raw.outputTokens),
    reasoningOutputTokens: number(raw.reasoning_output_tokens ?? raw.reasoningOutputTokens)
  };
  usage.totalTokens = usage.inputTokens + usage.outputTokens;
  return Object.freeze(usage);
}

export function createAgentAdapter({
  workspaceRoot,
  reposRoot,
  knowledge,
  env = process.env,
  probeRuntime = probeCodexRuntime,
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
  runtimeImpl = null,
  onActivity = () => {},
  onTaskSettled = async () => {}
} = {}) {
  const configuredKind = boundedText(env.TOTEM_AGENT_ADAPTER, 32)?.toLowerCase() ?? "off";
  const state = {
    configuredKind,
    available: false,
    reason: null,
    version: null,
    capabilities: null,
    ready: false,
    activeTask: null,
    lastTask: null,
    child: null,
    counter: 0
  };

  let codexBin = boundedText(env.TOTEM_CODEX_BIN, 512) ?? "codex";
  let codexCwd = null;
  let sandbox = boundedText(env.TOTEM_CODEX_SANDBOX, 64) ?? "workspace-write";
  let model = boundedText(env.TOTEM_CODEX_MODEL, 128);

  if (!ALLOWED_SANDBOXES.has(sandbox)) {
    state.reason = `unsupported TOTEM_CODEX_SANDBOX: ${sandbox}`;
  } else {
    try {
      codexCwd = safeWorkspaceCwd(env.TOTEM_CODEX_CWD, { workspaceRoot, reposRoot });
    } catch (error) {
      state.reason = error instanceof Error ? error.message : String(error);
    }
  }

  if (configuredKind === "off" || configuredKind === "none" || configuredKind === "disabled") {
    state.reason = "agent adapter is disabled; set TOTEM_AGENT_ADAPTER=codex to enable dispatch";
  } else if (configuredKind !== "codex") {
    state.reason = `unsupported agent adapter: ${configuredKind}`;
  } else if (!state.reason) {
    try {
      const probe = spawnSyncImpl(codexBin, ["--version"], {
        cwd: codexCwd,
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"]
      });
      if (probe?.error) throw probe.error;
      if (typeof probe?.status === "number" && probe.status !== 0) {
        throw new Error(`codex --version exited with ${probe.status}`);
      }
      state.available = true;
      state.version = boundedText(probe?.stdout, 160) ?? "codex";
    } catch (error) {
      state.reason = sanitizeMessage(
        error instanceof Error ? error.message : String(error),
        { workspaceRoot, reposRoot }
      );
    }
  }

  const runner = runtimeImpl ?? new CodexRunner({ spawnImpl, probeRuntime, codexBin, env });
  let capabilityProbe = null;
  let runtimeSnapshot = null;
  async function refreshCapabilities() {
    if (!state.available) return null;
    if (runtimeSnapshot && Date.now() - runtimeSnapshot.observedAt < 60_000) return runtimeSnapshot;
    if (capabilityProbe) return capabilityProbe;
    capabilityProbe = probeRuntime({ codexBin, cwd: codexCwd, env, spawnImpl }).then(runtime => {
      state.capabilities = { ...runtime.capabilities, cliAvailable: true, version: state.version };
      state.ready = runtime.capabilities?.appServerAvailable === true && runtime.models?.length > 0;
      runtimeSnapshot = { ...runtime, observedAt: Date.now() };
      return runtime;
    }).finally(() => { capabilityProbe = null; });
    return capabilityProbe;
  }

  function status() {
    return Object.freeze({
      schemaVersion: ADAPTER_SCHEMA_VERSION,
      kind: configuredKind,
      configured: configuredKind === "codex",
      available: state.available && state.ready,
      busy: Boolean(state.activeTask),
      version: state.version,
      ready: state.ready,
      capabilities: state.capabilities,
      sandbox,
      model: model ?? null,
      reason: state.reason,
      currentTask: publicTask(state.activeTask),
      lastTask: publicTask(state.lastTask)
    });
  }

  function emit(value) {
    try {
      return onActivity(value);
    } catch {
      return null;
    }
  }

  async function settle(task, finalState, error = null) {
    if (task.settled) return;
    task.settled = true;
    task.state = finalState;
    task.completedAt = nowIso();
    task.error = error
      ? sanitizeMessage(error, { workspaceRoot, reposRoot })
      : null;
    if (state.activeTask === task) state.activeTask = null;
    state.lastTask = task;
    state.child = null;

    emit({
      type: finalState === "completed" ? "task_completed" : "task_failed",
      source: "codex-adapter",
      taskId: task.id,
      moduleId: task.moduleId,
      featureId: task.featureId,
      summary: finalState === "completed"
        ? "Codex task completed"
        : `Codex task failed${task.error ? `: ${task.error}` : ""}`
    });

    try {
      await onTaskSettled(publicTask(task));
    } catch {
      // A refresh failure must not rewrite the already-final Codex task result.
    }
  }

  function handleCodexEvent(task, event) {
    if (!event || typeof event !== "object") return;

    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      task.threadId = event.thread_id;
      emit({
        type: "thread_started",
        source: "codex-adapter",
        taskId: task.id,
        moduleId: task.moduleId,
        featureId: task.featureId,
        summary: `Codex thread ${event.thread_id}`
      });
      return;
    }

    if (event.type === "turn.started") {
      emit({
        type: "turn_started",
        source: "codex-adapter",
        taskId: task.id,
        moduleId: task.moduleId,
        featureId: task.featureId,
        summary: "Codex turn started"
      });
      return;
    }

    if (event.type === "turn.completed" || event.type === "usage.updated") {
      if (!event.usage) return;
      task.usage = normalizedUsage(event.usage ?? {});
      emit({
        type: "usage_updated",
        source: "codex-adapter",
        taskId: task.id,
        moduleId: task.moduleId,
        featureId: task.featureId,
        summary: `Tokens · in ${task.usage.inputTokens} · cached ${task.usage.cachedInputTokens} · out ${task.usage.outputTokens}`,
        usage: task.usage
      });
      return;
    }

    if (event.type === "turn.failed") {
      const message = event.error?.message ?? "Codex turn failed";
      void settle(task, "failed", message);
      return;
    }
    if (event.type === "error") {
      // App Server can retry a transient notification. Only the runner settles the turn.
      return;
    }

    if (["agent.spawned", "agent.completed", "model.selected", "context.reused", "escalation"].includes(event.type)) {
      if (event.type === "model.selected") task.chosenModel = boundedText(event.model, 128);
      emit({ type: event.type.replaceAll(".", "_"), source: "codex-adapter", taskId: task.id,
        moduleId: task.moduleId, featureId: task.featureId,
        model: boundedText(event.model, 128), agentId: boundedText(event.agentId, 160),
        summary: boundedText(event.summary, 500) ?? event.type });
      return;
    }
    const item = eventItem(event);
    if (!item) return;

    if (item.type === "agent_message" && event.type === "item.completed") {
      const message = boundedText(item.text, 12000);
      if (message) {
        task.finalMessage = message;
        emit({
          type: "agent_message",
          source: "codex-adapter",
          taskId: task.id,
          moduleId: task.moduleId,
          featureId: task.featureId,
          summary: boundedText(message.replace(/\s+/g, " "), 500),
          detail: message
        });
      }
      return;
    }

    // Codex reasoning items are intentionally not mirrored to the browser.
    // The console exposes observable work and final messages, not hidden chain-of-thought.
    if (item.type === "reasoning") return;

    if (item.type === "file_change" && event.type === "item.completed") {
      for (const change of item.changes ?? []) {
        const mapped = moduleFileFor(change.path, {
          cwd: task.cwd ?? codexCwd,
          workspaceRoot,
          reposRoot,
          knowledge
        });
        if (!mapped) continue;
        emit({
          type: "file_edit",
          source: "codex-adapter",
          taskId: task.id,
          moduleId: mapped.moduleId ?? task.moduleId,
          featureId: task.featureId,
          file: mapped.file,
          summary: `Codex ${boundedText(change.kind, 40) ?? "changed"} ${path.posix.basename(mapped.file)}`,
          detail: boundedText(change.diff, 6000)
        });
      }
      return;
    }

    if (item.type === "mcp_tool_call") {
      const tool = [boundedText(item.server, 80), boundedText(item.tool, 120)].filter(Boolean).join("/");
      if (event.type === "item.started") {
        emit({
          type: "tool_started",
          source: "codex-adapter",
          taskId: task.id,
          moduleId: task.moduleId,
          featureId: task.featureId,
          tool,
          summary: `MCP ${tool || "tool"} started`,
          detail: jsonDetail(item.arguments ?? item.tool_arguments ?? item.input, 4000)
        });
        emit({
          type: "dependency_followed",
          source: "codex-adapter",
          taskId: task.id,
          moduleId: task.moduleId,
          featureId: task.featureId,
          summary: `MCP ${tool || "tool"}`
        });
      } else if (event.type === "item.completed") {
        emit({
          type: "tool_completed",
          source: "codex-adapter",
          taskId: task.id,
          moduleId: task.moduleId,
          featureId: task.featureId,
          tool,
          status: boundedText(item.status, 80) ?? "completed",
          summary: `MCP ${tool || "tool"} completed`,
          detail: jsonDetail(item.result ?? item.tool_result ?? item.output, 6000)
        });
      }
      return;
    }

    if (item.type === "command_execution") {
      const command = boundedText(item.command, 1200) ?? "";
      if (event.type === "item.started") {
        emit({
          type: "command_started",
          source: "codex-adapter",
          taskId: task.id,
          moduleId: task.moduleId,
          featureId: task.featureId,
          command,
          summary: command ? `$ ${command}` : "Command started"
        });
        return;
      }
      if (event.type !== "item.completed") return;

      const successful = item.exit_code == null
        ? item.status === "completed"
        : Number(item.exit_code) === 0;
      emit({
        type: "command_completed",
        source: "codex-adapter",
        taskId: task.id,
        moduleId: task.moduleId,
        featureId: task.featureId,
        command,
        status: successful ? "success" : "failed",
        summary: command
          ? `Command ${successful ? "completed" : "failed"} · ${command}`
          : `Command ${successful ? "completed" : "failed"}`,
        detail: boundedText(item.aggregated_output ?? item.aggregatedOutput ?? item.output, 6000)
      });

      if (!successful || !command) return;
      const milestoneType = /(^|\s)gh\s+pr\s+merge(?:\s|$)/i.test(command)
        ? "pr_merged"
        : /(^|\s)gh\s+pr\s+create(?:\s|$)/i.test(command)
          ? "pr_created"
          : /(^|\s)git\s+commit(?:\s|$)/i.test(command)
            ? "commit_created"
            : null;
      if (!milestoneType) return;

      emit({
        type: milestoneType,
        source: "codex-adapter",
        taskId: task.id,
        moduleId: task.moduleId,
        featureId: task.featureId,
        summary: milestoneType === "commit_created"
          ? "Git commit completed"
          : milestoneType === "pr_created"
            ? "GitHub pull request created"
            : "GitHub pull request merged"
      });
      return;
    }

    if (item.type === "web_search") {
      const query = boundedText(item.query, 800);
      emit({
        type: event.type === "item.started" ? "web_search_started" : "web_search_completed",
        source: "codex-adapter",
        taskId: task.id,
        moduleId: task.moduleId,
        featureId: task.featureId,
        summary: query ? `Web search · ${query}` : "Web search",
        detail: event.type === "item.completed" ? jsonDetail(item.results, 6000) : null
      });
      return;
    }

    if (item.type === "todo_list" && event.type === "item.completed") {
      emit({
        type: "todo_updated",
        source: "codex-adapter",
        taskId: task.id,
        moduleId: task.moduleId,
        featureId: task.featureId,
        summary: "Codex plan updated",
        detail: jsonDetail(item.items, 6000)
      });
    }
  }
  async function dispatch(request = {}) {
    if (!state.available) {
      const error = new Error(state.reason || "agent adapter is unavailable");
      error.code = "ADAPTER_UNAVAILABLE";
      throw error;
    }
    if (state.activeTask) {
      const error = new Error(`agent is busy with ${state.activeTask.id}`);
      error.code = "AGENT_BUSY";
      throw error;
    }
    const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
    if (!prompt || prompt.length > 120_000) {
      const error = new Error("prompt is required");
      error.code = "INVALID_PROMPT";
      throw error;
    }
    const selectedPlan = request.orchestrationPlan ?? buildOrchestrationPlan({
      query: prompt, moduleId: request.moduleId, featureId: request.featureId, knowledge
    });
    const requestedModel = boundedText(request.model, 128);

    const task = {
      id: `task:${Date.now()}:${++state.counter}`,
      adapter: "codex",
      state: "starting",
      moduleId: boundedText(request.moduleId, 128),
      featureId: boundedText(request.featureId, 160),
      threadId: null,
      startedAt: nowIso(),
      completedAt: null,
      summary: boundedText(request.summary ?? prompt, 220),
      error: null,
      finalMessage: null,
      usage: null,
      orchestration: orchestrationPlanSummary(selectedPlan),
      modelPolicy: null,
      settled: false
    };
    state.activeTask = task;

    let resolvedModel = model;
    let modelPolicy = null;
    let boundedContext;
    try {
      boundedContext = buildContextPack(prompt, {
        audience: "primary", moduleId: request.moduleId ?? null, knowledge,
        includeCode: true, maxTokens: 4000, orchestrationPlan: selectedPlan
      }).rendered;
      const runtime = await refreshCapabilities();
      modelPolicy = resolveModelPolicy({
        plan: selectedPlan,
        models: runtime.models,
        usage: runtime.usage,
        requestedModel: requestedModel ?? model,
        requestedEffort: null,
        hasImages: false,
        contextTokens: Math.ceil((prompt.length + (boundedContext?.length ?? 0)
          + buildDeveloperInstructions({ plan: selectedPlan }).length) / 4)
      });
      if (modelPolicy.mode === "blocked" || !modelPolicy.coordinator?.model) {
        const error = new Error(`Codex model policy blocked this task: ${(modelPolicy.reasonCodes ?? []).join(", ")}`);
        error.code = "MODEL_POLICY_BLOCKED";
        error.modelPolicy = modelPolicy;
        throw error;
      }
      resolvedModel = modelPolicy.coordinator.model;
      task.modelPolicy = modelPolicy;
    } catch (error) {
      await settle(task, "failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
    if (task.settled || state.activeTask !== task) {
      const cancelled = new Error("Codex task was cancelled before it could be started");
      void settle(task, "failed", cancelled.message);
      throw cancelled;
    }

    task.state = "running";
    const writableRoots = constrainedWriteRoots(selectedPlan, knowledge);
    task.cwd = executionWorkspace(codexCwd, writableRoots, sandbox === "read-only" || !writableRoots.length);
    emit({ type: "task_started", source: "codex-adapter", taskId: task.id,
      moduleId: task.moduleId, featureId: task.featureId, summary: "Codex task started" });
    const execution = runner.execute({
      key: task.id, workspace: codexCwd, prompt,
      orchestrationPlan: selectedPlan, modelPolicy, boundedContext,
      model: resolvedModel, reasoningEffort: modelPolicy.coordinator.effort,
      resumeSessionId: request.threadId ?? null,
      readOnly: sandbox === "read-only",
      autoApproveGradle: false,
      writableRoots,
      onSessionId: threadId => handleCodexEvent(task, { type: "thread.started", thread_id: threadId }),
      onProgress: event => {
        for (const normalized of normalizeAppServerEvent(event)) handleCodexEvent(task, normalized);
      },
      // Bridge has no approval interaction yet. Decline safely instead of hanging or granting permission.
      onApproval: approval => runner.approve(task.id, approval.requestId, "decline")
    });
    execution.then(result => {
      if (result.model && result.model !== task.chosenModel) handleCodexEvent(task, {
        type: "model.selected", model: result.model, summary: `Runtime reported model ${result.model}`
      });
      if (result.message && !task.finalMessage) handleCodexEvent(task, {
        type: "item.completed", item: { type: "agent_message", text: result.message }
      });
      if (result.usage) task.usage = normalizedUsage(result.usage.last ?? result.usage.total ?? result.usage);
      void settle(task, result.exitCode === 0 && !result.timedOut ? "completed" : "failed",
        result.exitCode === 0 && !result.timedOut ? null : "Codex App Server task failed or was interrupted");
    }).catch(error => void settle(task, "failed", error instanceof Error ? error.message : String(error)));
    return publicTask(task);
  }

  function close(reason = "Bridge shutdown interrupted active task") {
    const task = state.activeTask;
    if (task && !task.settled) {
      runner.cancel(task.id);
      void settle(task, "failed", reason);
    }
  }

  return Object.freeze({ status, dispatch, close, refreshCapabilities,
    steer: (text) => state.activeTask ? runner.steer(state.activeTask.id, text) : false });
}
