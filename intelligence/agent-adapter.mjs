import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

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
    error: task.error ?? null
  });
}

function promptEnvelope(request) {
  const lines = [
    "You are running through the TotemWorkspace local Codex agent adapter.",
    "Work only on the user's requested Totem development task.",
    "Use TotemWorkspace graph/MCP/skill context when available before broad repository search.",
    "Respect repository instructions and existing validation workflows.",
    "Do not expose credentials, secrets, or absolute local filesystem paths in user-facing summaries."
  ];
  if (request.moduleId) lines.push(`Semantic module focus: ${request.moduleId}`);
  if (request.featureId) lines.push(`Semantic feature focus: ${request.featureId}`);
  lines.push("", "User request:", request.prompt);
  return lines.join("\n");
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

export function createAgentAdapter({
  workspaceRoot,
  reposRoot,
  knowledge,
  env = process.env,
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
  onActivity = () => {},
  onTaskSettled = async () => {}
} = {}) {
  const configuredKind = boundedText(env.TOTEM_AGENT_ADAPTER, 32)?.toLowerCase() ?? "off";
  const state = {
    configuredKind,
    available: false,
    reason: null,
    version: null,
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

  function status() {
    return Object.freeze({
      schemaVersion: ADAPTER_SCHEMA_VERSION,
      kind: configuredKind,
      configured: configuredKind === "codex",
      available: state.available,
      busy: Boolean(state.activeTask),
      version: state.version,
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
      return;
    }
    if (event.type === "turn.completed") {
      void settle(task, "completed");
      return;
    }
    if (event.type === "turn.failed") {
      const message = event.error?.message ?? "Codex turn failed";
      void settle(task, "failed", message);
      return;
    }
    if (event.type === "error") {
      void settle(task, "failed", event.message ?? "Codex stream error");
      return;
    }

    const item = eventItem(event);
    if (!item) return;

    if (item.type === "file_change" && event.type === "item.completed") {
      for (const change of item.changes ?? []) {
        const mapped = moduleFileFor(change.path, {
          cwd: codexCwd,
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
          summary: `Codex ${boundedText(change.kind, 40) ?? "changed"} ${path.posix.basename(mapped.file)}`
        });
      }
      return;
    }

    if (item.type === "mcp_tool_call" && event.type === "item.started") {
      emit({
        type: "dependency_followed",
        source: "codex-adapter",
        taskId: task.id,
        moduleId: task.moduleId,
        featureId: task.featureId,
        summary: `MCP ${boundedText(item.server, 80) ?? "server"}/${boundedText(item.tool, 120) ?? "tool"}`
      });
    }
  }

  function dispatch(request = {}) {
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
    const prompt = boundedText(request.prompt, 8 * 1024);
    if (!prompt) {
      const error = new Error("prompt is required");
      error.code = "INVALID_PROMPT";
      throw error;
    }

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
      settled: false
    };
    state.activeTask = task;

    const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", sandbox, "--cd", codexCwd];
    if (model) args.push("--model", model);
    args.push("-");

    let child;
    try {
      child = spawnImpl(codexBin, args, {
        cwd: codexCwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      state.activeTask = null;
      state.lastTask = task;
      task.state = "failed";
      task.completedAt = nowIso();
      task.error = sanitizeMessage(error instanceof Error ? error.message : String(error), {
        workspaceRoot,
        reposRoot
      });
      const wrapped = new Error(task.error);
      wrapped.code = "ADAPTER_SPAWN_FAILED";
      throw wrapped;
    }

    state.child = child;
    task.state = "running";
    emit({
      type: "task_started",
      source: "codex-adapter",
      taskId: task.id,
      moduleId: task.moduleId,
      featureId: task.featureId,
      summary: "Codex task started"
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    const consumeLine = (line) => {
      const text = String(line ?? "").trim();
      if (!text) return;
      try {
        handleCodexEvent(task, JSON.parse(text));
      } catch {
        // Ignore malformed/non-JSON stdout. JSONL events remain authoritative.
      }
    };

    child.stdout?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => {
      stdoutBuffer += chunk;
      let newline;
      while ((newline = stdoutBuffer.indexOf("\n")) >= 0) {
        consumeLine(stdoutBuffer.slice(0, newline));
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
      }
    });

    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (chunk) => {
      if (stderrBuffer.length < 4000) stderrBuffer += String(chunk).slice(0, 4000 - stderrBuffer.length);
    });

    child.on?.("error", (error) => {
      void settle(task, "failed", error instanceof Error ? error.message : String(error));
    });
    child.on?.("close", (code, signal) => {
      if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
      if (task.settled) return;
      if (code === 0) {
        void settle(task, "completed");
        return;
      }
      const stderr = sanitizeMessage(stderrBuffer, { workspaceRoot, reposRoot });
      void settle(
        task,
        "failed",
        stderr || `Codex process exited with ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`
      );
    });

    child.stdin?.end?.(promptEnvelope({ ...request, prompt }));
    return publicTask(task);
  }

  function close() {
    const child = state.child;
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Best effort on Bridge shutdown.
      }
    }
  }

  return Object.freeze({
    status,
    dispatch,
    close
  });
}
