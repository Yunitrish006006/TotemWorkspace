import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { buildDeveloperInstructions, ensureProgressPrefix } from "./runtime-policy.mjs";
import { userInputFromRequest, userInputResponse } from "./user-input.mjs";
import { createUsageGuard, validateUsageGuardMode } from "./usage-guard.mjs";
import { boundedFollowupContext, boundedRuntimeContext, constrainReadOnlyPlan, constrainedWriteRoots, executionWorkspace } from "./orchestration-context.mjs";
import { acquireRuntimeWriteLease } from "./write-leases.mjs";
import { buildOrchestrationPlan } from "../orchestration-plan.mjs";
import { loadKnowledge } from "../workspace-knowledge.mjs";
import { prepareTurnRouting, selectTurnPolicy } from "./turn-routing.mjs";
import { createTurnTelemetry, isCompactionEvent } from "./telemetry.mjs";
import { probeCodexRuntime } from "../codex-runtime-probe.mjs";
import { activeWorkItem, captureRepositoryCheckpoint, loadWorkRegistry, resumeCheckpointForTask } from "../work-registry.mjs";
import { createGoalRunController } from "./goal-run-controller.mjs";
import { nativeGoalRevision } from "./goal-lifecycle.mjs";

const MAX_PROMPT_LENGTH = 120_000;
const MAX_IMAGE_INPUTS = 4;
const MODEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const REASONING_EFFORT_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const MAX_ERROR_LENGTH = 8_000;
const MODEL_LIST_TIMEOUT_MS = 15_000;
const GOAL_RPC_TIMEOUT_MS = 15_000;
const MAX_PENDING_GOAL_EVENTS = 256;
const NOOP_CALLBACK = () => {};
const NOOP_ASYNC_CALLBACK = async () => {};
const MODEL_LIST_PAGE_SIZE = 100;
function mergeUsageSnapshots(previous, next) {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)
      || !next || typeof next !== 'object' || Array.isArray(next)) return next ?? previous;
  const merged = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    const prior = previous[key];
    if (Number.isFinite(value) && Number.isFinite(prior)) merged[key] = Math.max(prior, value);
    else if (value && typeof value === 'object' && !Array.isArray(value)
        && prior && typeof prior === 'object' && !Array.isArray(prior)) merged[key] = mergeUsageSnapshots(prior, value);
    else merged[key] = value;
  }
  return merged;
}
function freezeDecision(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeDecision); Object.freeze(value); }
  return value;
}

export function workspacePlan({ prompt, workspace, routing = null }) {
  const knowledge = loadKnowledge();
  const moduleId = routing?.classification === "operational" ? "totem-workspace"
    : path.resolve(workspace) === path.resolve(knowledge.root) ? "totem-workspace"
    : knowledge.modules.find((module) => module.repoName === path.basename(workspace))?.id ?? null;
  return buildOrchestrationPlan({ query: prompt, moduleId, knowledge });
}

export function shouldInheritActiveTask(routing) {
  return routing?.classification === "continuation" || routing?.classification === "ambiguous";
}

export function resolveActiveRuntimeTask(workspace = null, knowledge = loadKnowledge()) {
  try {
    const work = activeWorkItem(loadWorkRegistry(knowledge.root));
    const task = work?.tasks?.find((entry) => entry.id === work.currentTaskId) ?? null;
    if (!task || task.status !== "in-progress") return null;
    const repositoryName = String(task.repository ?? "").split("/").at(-1);
    if (!repositoryName || (workspace && repositoryName !== path.basename(path.resolve(workspace)))) return null;
    return Object.freeze({
      workId: work.id,
      workTitle: work.title,
      objective: work.objective,
      taskId: task.id,
      title: task.title,
      currentTaskNumber: work.tasks.findIndex((entry) => entry.id === task.id) + 1,
      totalTasks: work.tasks.length,
      goal: task.goal,
      primaryConcept: task.primaryConcept,
      repository: task.repository,
      dependsOn: Object.freeze([...(task.dependsOn ?? [])]),
      doneCriteria: Object.freeze([...(task.doneCriteria ?? [])]),
      stopBoundary: task.stopBoundary,
      resumeCheckpoint: resumeCheckpointForTask(knowledge.root, work.id, task.id)
    });
  } catch {
    return null;
  }
}

function expiredSession(message) {
  return /(?:thread|conversation|session).*(?:expired|not found|does not exist)|(?:expired|not found).*(?:thread|conversation|session)/i.test(message?.error?.message ?? "");
}

const GRADLE_EXECUTABLE = /(?:^|\/)gradlew?$/;
const GRADLE_SAFE_FLAG = /^(?:--(?:no-daemon|stacktrace|full-stacktrace|info|debug|offline|rerun-tasks|continue|configuration-cache|no-configuration-cache|build-cache|no-build-cache)|--(?:console|warning-mode)=[a-z-]+|-[qidsS])$/;
const GRADLE_COMPILE_TASK = /^(?::[a-zA-Z0-9_.-]+)*(?::)?(?:assemble|build|classes|compile[a-zA-Z0-9]*|jar|test|check|process[a-zA-Z0-9]*Resources|run(?:Client)?GameTest)$/;

export function validatePrompt(prompt) {
  const normalized = prompt?.trim();
  if (!normalized) throw new Error("Task cannot be empty");
  if (normalized.length > MAX_PROMPT_LENGTH) throw new Error(`Task must be at most ${MAX_PROMPT_LENGTH} characters`);
  return normalized;
}

function validateGoalRun(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.resume !== 'boolean' && value.resume !== undefined
      || typeof value.forkRecovery !== 'boolean' && value.forkRecovery !== undefined) {
    throw new TypeError('Goal run options are invalid');
  }
  const resume = value.resume === true;
  const objective = value.objective === undefined || value.objective === null ? null
    : typeof value.objective === 'string' ? value.objective.trim() : '';
  if ((!resume && !objective) || (objective !== null && (!objective || objective.length > 4_000))) {
    throw new RangeError('Goal objective must contain between 1 and 4000 characters');
  }
  const tokenBudget = value.tokenBudget;
  if (tokenBudget !== undefined && (!Number.isSafeInteger(tokenBudget) || tokenBudget < 1)) {
    throw new RangeError('Goal tokenBudget must be a positive safe integer');
  }
  const expectedRevision = value.expectedRevision;
  if (expectedRevision !== undefined && (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision))) {
    throw new TypeError('Goal expectedRevision is invalid');
  }
  const forkRecovery = value.forkRecovery === true;
  const resumeBudgetLimited = value.resumeBudgetLimited === true;
  if (value.resumeBudgetLimited !== undefined && typeof value.resumeBudgetLimited !== 'boolean') {
    throw new TypeError('Goal resumeBudgetLimited must be a boolean');
  }
  if (resumeBudgetLimited && (!resume || tokenBudget === undefined || (!expectedRevision && !forkRecovery))) {
    throw new TypeError('Budget-limited Goal recovery requires exact resume, a new budget, and either a bound revision or validated fork recovery');
  }
  if (resume && tokenBudget !== undefined && !resumeBudgetLimited) {
    throw new TypeError('Goal resume budget changes require explicit budget-limited recovery');
  }
  if (forkRecovery && (!resume || expectedRevision !== undefined)) {
    throw new TypeError('Forked Goal recovery requires exact resume without applying the source-thread revision to the new target');
  }
  return Object.freeze({ resume, objective, ...(tokenBudget === undefined ? {} : { tokenBudget }),
    ...(resumeBudgetLimited ? { resumeBudgetLimited } : {}),
    ...(forkRecovery ? { forkRecovery } : {}),
    ...(expectedRevision === undefined ? {} : { expectedRevision }) });
}

export function validateModel(model) {
  if (model === null || model === undefined || model === "default") return null;
  const normalized = model.trim();
  if (!MODEL_NAME.test(normalized)) throw new Error("Model name must be 1–80 letters, numbers, dots, dashes, or underscores");
  return normalized;
}

export function validateReasoningEffort(effort) {
  if (effort === null || effort === undefined || effort === "default") return null;
  const normalized = effort.trim();
  if (!REASONING_EFFORT_NAME.test(normalized)) {
    throw new Error("Reasoning effort must be 1–80 letters, numbers, dashes, or underscores");
  }
  return normalized;
}

export function imageInputs(imageUrls = []) {
  if (!Array.isArray(imageUrls)) throw new Error("Image inputs must be an array");
  if (imageUrls.length > MAX_IMAGE_INPUTS) throw new Error(`At most ${MAX_IMAGE_INPUTS} images can be sent to Codex at once`);
  return imageUrls.map((url) => {
    if (typeof url !== "string" || !url.trim()) throw new Error("Image URL must be a non-empty string");
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Image URL must be valid");
    }
    if (parsed.protocol !== "https:") throw new Error("Image URL must use HTTPS");
    return Object.freeze({ type: "image", url: parsed.toString() });
  });
}

export function threadStartParams({ workspace, model = null, reasoningEffort = null, runtimeWorkspaceRoots = null, modelPolicy = null, orchestrationPlan = null, activeWorkTask = null, progressWorkTask = activeWorkTask, writableRoots = [workspace], readOnly = false, usageGuardMode = 'enforce' }) {
  const effort = validateReasoningEffort(reasoningEffort);
  return compactObject({
    cwd: workspace,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: readOnly ? "read-only" : "workspace-write",
    developerInstructions: buildDeveloperInstructions({ modelPolicy, plan: orchestrationPlan, activeWorkTask, progressWorkTask, usageGuardMode }),
    ...(effort ? { config: { model_reasoning_effort: effort } } : {}),
    ...(runtimeWorkspaceRoots === null ? {} : { runtimeWorkspaceRoots }),
    model
  });
}

export function threadResumeParams({ threadId, workspace, model = null, reasoningEffort = null, runtimeWorkspaceRoots = null, modelPolicy = null, orchestrationPlan = null, activeWorkTask = null, progressWorkTask = activeWorkTask, writableRoots = [workspace], readOnly = false, usageGuardMode = 'enforce', excludeTurns = false }) {
  if (typeof threadId !== "string" || !threadId.trim()) throw new Error("Saved Codex session ID is invalid");
  return compactObject({ threadId, ...(excludeTurns ? { excludeTurns: true } : {}),
    ...threadStartParams({ workspace, model, reasoningEffort, runtimeWorkspaceRoots, modelPolicy, orchestrationPlan,
      activeWorkTask, progressWorkTask, writableRoots, readOnly, usageGuardMode }) });
}

export function threadForkParams({ threadId, lastTurnId, workspace, model = null, modelPolicy = null,
  orchestrationPlan = null, activeWorkTask = null, progressWorkTask = activeWorkTask, writableRoots = [workspace], readOnly = false,
  usageGuardMode = 'enforce' }) {
  if (typeof threadId !== 'string' || !threadId.trim()) throw new Error('Fork source thread ID is invalid');
  if (typeof lastTurnId !== 'string' || !lastTurnId.trim()) throw new Error('Fork anchor turn ID is invalid');
  return compactObject({ threadId, lastTurnId, deferGoalContinuation: true, excludeTurns: true,
    ...threadStartParams({ workspace, model, modelPolicy, orchestrationPlan, activeWorkTask, progressWorkTask,
      writableRoots, readOnly, usageGuardMode }) });
}

export function turnStartParams({ threadId, workspace, prompt, model = null, reasoningEffort = null, imageUrls = [], writableRoots = [workspace], readOnly = false }) {
  if (typeof threadId !== "string" || !threadId.trim()) throw new Error("Saved Codex session ID is invalid");
  return compactObject({
    threadId,
    input: [{ type: "text", text: validatePrompt(prompt) }, ...imageInputs(imageUrls)],
    cwd: workspace,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxPolicy: readOnly ? { type: "readOnly" } : {
      type: "workspaceWrite",
      writableRoots,
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    },
    model,
    effort: validateReasoningEffort(reasoningEffort)
  });
}

/**
 * Builds the deliberately narrow App Server request used to redirect an
 * in-flight turn. Unlike turn/start, steering must not be able to alter the
 * workspace, model, approvals, or sandbox chosen for the task.
 */
export function turnSteerParams({ threadId, expectedTurnId, prompt, imageUrls = [], clientUserMessageId = null }) {
  if (typeof threadId !== "string" || !threadId.trim()) throw new Error("Saved Codex session ID is invalid");
  if (typeof expectedTurnId !== "string" || !expectedTurnId.trim()) throw new Error("Active Codex turn ID is invalid");
  if (clientUserMessageId !== null && clientUserMessageId !== undefined
    && (typeof clientUserMessageId !== "string" || !clientUserMessageId.trim() || clientUserMessageId.length > 200)) {
    throw new Error("Client message ID is invalid");
  }
  return compactObject({
    threadId,
    expectedTurnId,
    input: [{ type: "text", text: validatePrompt(prompt) }, ...imageInputs(imageUrls)],
    clientUserMessageId: clientUserMessageId?.trim() || null
  });
}

export function approvalResponse(approval, choice) {
  if (!approval || typeof approval !== "object") throw new Error("Approval request is invalid");
  if (approval.kind === "command" || approval.kind === "file-change") {
    let decision = choice === "allow" ? "accept"
      : choice === "allow-session" ? "acceptForSession"
        : choice === "cancel" ? "cancel" : "decline";
    if (approval.kind === "command" && choice === "decline" && Array.isArray(approval.availableDecisions)
      && !approval.availableDecisions.includes("decline") && approval.availableDecisions.includes("cancel")) {
      decision = "cancel";
    }
    if (approval.kind === "command" && Array.isArray(approval.availableDecisions)
      && !approval.availableDecisions.includes(decision)) {
      throw new Error("That approval choice is not available for this command");
    }
    return { decision };
  }
  if (approval.kind === "permissions") {
    if (choice !== "allow" && choice !== "allow-session") return { permissions: {}, scope: "turn" };
    const requested = approval.permissions ?? {};
    const permissions = {};
    if (requested.network) permissions.network = requested.network;
    if (requested.fileSystem) permissions.fileSystem = requested.fileSystem;
    return { permissions, scope: choice === "allow-session" ? "session" : "turn" };
  }
  throw new Error("This approval type is not supported");
}

/**
 * Gradle compilation, test, and packaging tasks are repeatable local checks
 * for this bridge. Auto-approval intentionally excludes shell wrappers,
 * deletion, publishing, arbitrary Gradle properties, and all non-Gradle work.
 */
export function isAutoApprovedGradleCompile(approval) {
  if (approval?.kind !== "command" || typeof approval.command !== "string") return false;
  if (approval.network) return false;
  if (Array.isArray(approval.availableDecisions) && !approval.availableDecisions.includes("accept")) return false;

  const command = approval.command.trim();
  if (!command || /[|;&><`$\r\n]/.test(command)) return false;
  const [executable, ...arguments_] = command.split(/\s+/);
  if (!GRADLE_EXECUTABLE.test(executable)) return false;

  const tasks = arguments_.filter((argument) => !argument.startsWith("-"));
  return tasks.length > 0
    && arguments_.every((argument) => argument.startsWith("-") ? GRADLE_SAFE_FLAG.test(argument) : GRADLE_COMPILE_TASK.test(argument));
}

export function finalAgentMessage(turn) {
  const messages = Array.isArray(turn?.items) ? turn.items.filter((item) => item?.type === "agentMessage") : [];
  return [...messages].reverse().find((item) => typeof item.text === "string" && item.text.trim())?.text.trim() ?? "";
}

export function generatedImagePaths(turn) {
  if (!Array.isArray(turn?.items)) return [];
  return turn.items
    .filter((item) => item?.type === "imageGeneration" && typeof item.savedPath === "string" && item.savedPath)
    .map((item) => item.savedPath);
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined));
}

function tail(text, limit = MAX_ERROR_LENGTH) {
  return text.length <= limit ? text : text.slice(-limit);
}

function rpcError(message) {
  const detail = message?.error?.message ?? "Unknown Codex App Server error";
  return new Error(detail);
}

function isServerRequest(message) {
  return typeof message?.method === "string" && Object.hasOwn(message, "id");
}

function approvalFromRequest(message) {
  const params = message.params ?? {};
  if (message.method === "item/commandExecution/requestApproval") {
    return {
      kind: "command",
      requestId: String(message.id),
      itemId: params.itemId,
      threadId: params.threadId,
      turnId: params.turnId,
      command: params.command ?? null,
      cwd: params.cwd ?? null,
      reason: params.reason ?? null,
      network: params.networkApprovalContext ?? null,
      availableDecisions: Array.isArray(params.availableDecisions) ? params.availableDecisions : null
    };
  }
  if (message.method === "item/fileChange/requestApproval") {
    return {
      kind: "file-change",
      requestId: String(message.id),
      itemId: params.itemId,
      threadId: params.threadId,
      turnId: params.turnId,
      reason: params.reason ?? null,
      grantRoot: params.grantRoot ?? null
    };
  }
  if (message.method === "item/permissions/requestApproval") {
    return {
      kind: "permissions",
      requestId: String(message.id),
      itemId: params.itemId,
      threadId: params.threadId,
      turnId: params.turnId,
      cwd: params.cwd ?? null,
      reason: params.reason ?? null,
      permissions: params.permissions ?? {}
    };
  }
  return null;
}

export class CodexRunner {
  #maxRuntimeMs;
  #spawn;
  #runs = new Map();
  #preflights = new Map();
  #probeRuntime;
  #plan;
  #codexBin;
  #env;
  #defaultPlanning;
  #leaseDirectory;
  #usageGuardMode;

  constructor({ maxRuntimeMs, spawnImpl = spawn, probeRuntime = probeCodexRuntime, planImpl = workspacePlan, codexBin = "codex", env = process.env, leaseDirectory, usageGuardMode = 'enforce' } = {}) {
    this.#usageGuardMode = validateUsageGuardMode(usageGuardMode);
    this.#maxRuntimeMs = maxRuntimeMs;
    this.#spawn = spawnImpl;
    this.#probeRuntime = probeRuntime;
    this.#plan = planImpl;
    this.#codexBin = codexBin;
    this.#env = env;
    this.#defaultPlanning = planImpl === workspacePlan;
    this.#leaseDirectory = leaseDirectory;
  }

  isRunning(key) {
    return this.#runs.has(key) || this.#preflights.has(key);
  }

  cancel(key) {
    const preflight = this.#preflights.get(key);
    if (preflight) { preflight.cancelled = true; return true; }
    const run = this.#runs.get(key);
    if (!run) return false;
    run.cancel();
    return true;
  }

  pauseGoal(key, expectedTurn = null) {
    return this.#runs.get(key)?.pauseGoal(expectedTurn) ?? false;
  }

  setGoalBudget(key, tokenBudget, expectedRevision) {
    return this.#runs.get(key)?.setGoalBudget(tokenBudget, expectedRevision) ?? false;
  }

  resumeBudgetLimitedGoal(key, expectedRevision) {
    return this.#runs.get(key)?.resumeBudgetLimitedGoal(expectedRevision) ?? false;
  }

  approve(key, requestId, choice) {
    const run = this.#runs.get(key);
    return run?.approve(requestId, choice) ?? false;
  }

  answerUserInput(key, requestId, answers) {
    return this.#runs.get(key)?.answerUserInput(requestId, answers) ?? false;
  }

  approveAll(key, requestId) {
    const run = this.#runs.get(key);
    return run?.approveAll(requestId) ?? false;
  }

  /**
   * Appends user input to the single turn already in progress for this
   * workspace session. Calls made while turn/start is still resolving are
   * held by the run and sent in arrival order once its IDs are known.
   */
  async steer(key, { prompt, imageUrls = [], clientUserMessageId = null } = {}) {
    const safePrompt = validatePrompt(prompt);
    const safeImageUrls = imageInputs(imageUrls).map((image) => image.url);
    const safeClientUserMessageId = clientUserMessageId === null || clientUserMessageId === undefined
      ? null
      : (() => {
        if (typeof clientUserMessageId !== "string" || !clientUserMessageId.trim() || clientUserMessageId.length > 200) {
          throw new Error("Client message ID is invalid");
        }
        return clientUserMessageId.trim();
      })();
    const preflight = this.#preflights.get(key);
    if (preflight) await preflight.ready;
    const run = this.#runs.get(key);
    if (!run) throw new Error("No active Codex turn is available to steer.");
    if (safeImageUrls.length && run.modelPolicy?.mode === "spark-only") {
      const error = new Error("Spark-only tasks cannot accept image steering input.");
      error.code = "MODEL_POLICY_BLOCKED";
      throw error;
    }
    return await run.steer({
      prompt: safePrompt,
      imageUrls: safeImageUrls,
      clientUserMessageId: safeClientUserMessageId
    });
  }

  /**
   * Reads the model picker catalog from the locally authenticated Codex App
   * Server. The result intentionally excludes hidden and malformed entries so
   * callers can expose it directly to a user-facing selector.
   */
  async listModels({ workspace }) {
    if (typeof workspace !== "string" || !workspace.trim()) {
      throw new Error("A workspace is required to read the Codex model catalog");
    }

    return await new Promise((resolve, reject) => {
      let child;
      try {
        child = this.#spawn(this.#codexBin, ["app-server"], { cwd: workspace, env: this.#env, stdio: ["pipe", "pipe", "pipe"] });
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      let stderr = "";
      let nextRequestId = 0;
      let nextCursor = null;
      const seenCursors = new Set();
      const models = new Map();

      const cleanup = () => {
        clearTimeout(timer);
        lines.close();
        if (!child.killed) child.kill("SIGTERM");
      };
      const finish = (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const send = (message) => {
        if (child.stdin.destroyed || child.killed) return false;
        child.stdin.write(`${JSON.stringify(message)}\n`);
        return true;
      };
      const request = (method, params) => {
        const id = ++nextRequestId;
        if (!send({ method, id, params })) throw new Error("Codex App Server is no longer running");
        return id;
      };
      const requestModelPage = () => {
        request("model/list", {
          limit: MODEL_LIST_PAGE_SIZE,
          includeHidden: false,
          ...(nextCursor ? { cursor: nextCursor } : {})
        });
      };
      const acceptModel = (entry) => {
        if (!entry || entry.hidden) return;
        const rawModel = typeof entry.model === "string" ? entry.model : entry.id;
        let id;
        try {
          id = validateModel(rawModel);
        } catch {
          return;
        }
        if (!id) return;
        const displayName = typeof entry.displayName === "string" && entry.displayName.trim()
          ? entry.displayName.trim()
          : id;
        const supportedReasoningEfforts = Array.isArray(entry.supportedReasoningEfforts)
          ? entry.supportedReasoningEfforts.flatMap((option) => {
            try {
              const reasoningEffort = validateReasoningEffort(option?.reasoningEffort);
              if (!reasoningEffort) return [];
              return [Object.freeze({
                reasoningEffort,
                description: typeof option.description === "string" ? option.description.trim() : ""
              })];
            } catch {
              return [];
            }
          })
          : [];
        let defaultReasoningEffort = null;
        try {
          defaultReasoningEffort = validateReasoningEffort(entry.defaultReasoningEffort);
        } catch {
          // Old or custom catalogs can omit this value; the model default still works.
        }
        const inputModalities = Array.isArray(entry.inputModalities)
          ? Object.freeze([...new Set(entry.inputModalities.filter((modality) => typeof modality === "string"))])
          : Object.freeze(["text", "image"]);
        models.set(id, Object.freeze({
          id,
          displayName,
          isDefault: entry.isDefault === true,
          defaultReasoningEffort,
          supportedReasoningEfforts: Object.freeze(supportedReasoningEfforts),
          inputModalities
        }));
      };
      const timer = setTimeout(() => fail(new Error("Timed out while reading the Codex model catalog")), MODEL_LIST_TIMEOUT_MS);
      const lines = createInterface({ input: child.stdout });

      lines.on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (!Object.hasOwn(message ?? {}, "id")) return;
        try {
          if (message.id === 1) {
            if (message.error) throw rpcError(message);
            if (!send({ method: "initialized", params: {} })) {
              throw new Error("Codex App Server is no longer running");
            }
            requestModelPage();
            return;
          }
          if (message.id <= 1) return;
          if (message.error) throw rpcError(message);
          const page = message.result;
          if (!Array.isArray(page?.data)) throw new Error("Codex App Server returned an invalid model catalog");
          page.data.forEach(acceptModel);
          nextCursor = typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : null;
          if (nextCursor) {
            if (seenCursors.has(nextCursor)) throw new Error("Codex App Server returned a repeated model catalog cursor");
            seenCursors.add(nextCursor);
            requestModelPage();
            return;
          }
          finish([...models.values()]);
        } catch (error) {
          fail(error);
        }
      });
      child.stderr.on("data", (chunk) => { stderr = tail(`${stderr}${chunk}`); });
      child.once("error", fail);
      child.once("close", () => {
        if (!settled) fail(new Error(stderr.trim() || "Codex App Server stopped before returning its model catalog"));
      });

      try {
        request("initialize", {
          clientInfo: { name: "totem_workspace", title: "TotemWorkspace", version: "0.1.0" }
        });
      } catch (error) {
        fail(error);
      }
    });
  }

  /**
   * Reads the authenticated ChatGPT account's current Codex rate-limit
   * snapshot. This is intentionally a short-lived read-only App Server
   * connection, separate from a coding turn and its workspace session.
   */
  async getUsage({ workspace }) {
    if (typeof workspace !== "string" || !workspace.trim()) {
      throw new Error("A workspace is required to read Codex usage limits");
    }

    return await new Promise((resolve, reject) => {
      let child;
      try {
        child = this.#spawn(this.#codexBin, ["app-server"], { cwd: workspace, env: this.#env, stdio: ["pipe", "pipe", "pipe"] });
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      let stderr = "";
      let nextRequestId = 0;
      const cleanup = () => {
        clearTimeout(timer);
        lines.close();
        if (!child.killed) child.kill("SIGTERM");
      };
      const finish = (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const send = (message) => {
        if (child.stdin.destroyed || child.killed) return false;
        child.stdin.write(`${JSON.stringify(message)}\n`);
        return true;
      };
      const request = (method, params) => {
        const id = ++nextRequestId;
        if (!send({ method, id, params })) throw new Error("Codex App Server is no longer running");
        return id;
      };
      const timer = setTimeout(() => fail(new Error("Timed out while reading Codex usage limits")), MODEL_LIST_TIMEOUT_MS);
      const lines = createInterface({ input: child.stdout });

      lines.on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (!Object.hasOwn(message ?? {}, "id")) return;
        try {
          if (message.id === 1) {
            if (message.error) throw rpcError(message);
            if (!send({ method: "initialized", params: {} })) {
              throw new Error("Codex App Server is no longer running");
            }
            request("account/rateLimits/read");
            return;
          }
          if (message.id <= 1) return;
          if (message.error) throw rpcError(message);
          if (!message.result || typeof message.result !== "object" || Array.isArray(message.result)
            || !Object.hasOwn(message.result, "rateLimits")) {
            throw new Error("Codex App Server returned invalid usage limits");
          }
          finish(message.result);
        } catch (error) {
          fail(error);
        }
      });
      child.stderr.on("data", (chunk) => { stderr = tail(`${stderr}${chunk}`); });
      child.once("error", fail);
      child.once("close", () => {
        if (!settled) fail(new Error(stderr.trim() || "Codex App Server stopped before returning usage limits"));
      });

      try {
        request("initialize", {
          clientInfo: { name: "totem_workspace", title: "TotemWorkspace", version: "0.1.0" }
        });
      } catch (error) {
        fail(error);
      }
    });
  }

  async execute({ key, workspace, prompt, model = null, reasoningEffort = null, imageUrls = [], resumeSessionId = null, resumePolicy = 'fallback', forkFrom = null, prepareForkGoal = false, goalRun: goalRunInput = null, resumeCheckpoint = null, onBeforeFork = NOOP_ASYNC_CALLBACK, onSessionId = NOOP_CALLBACK, onForkPrepared = NOOP_ASYNC_CALLBACK, onProgress = () => {}, onUsageCheckpoint = () => {}, onApproval = () => {}, onUserInput = null, onModelPolicy = () => {}, orchestrationPlan = null, modelPolicy = null, boundedContext = null, writableRoots = null, readOnly = false, autoApproveGradle = true }) {
    if (this.isRunning(key)) throw new Error("A Codex task is already running for this workspace session");
    const goalRun = validateGoalRun(goalRunInput);
    if (goalRun?.resume && forkFrom && !goalRun.forkRecovery) {
      throw new TypeError('Forked Goal resume requires explicit fork recovery');
    }
    if (goalRun?.forkRecovery && (!forkFrom || resumeSessionId || onBeforeFork === NOOP_ASYNC_CALLBACK
        || onSessionId === NOOP_CALLBACK || onForkPrepared === NOOP_ASYNC_CALLBACK)) {
      throw new TypeError('Forked Goal recovery requires a source fork and explicit validation/binding callbacks');
    }
    if (goalRun && prepareForkGoal) throw new TypeError('Goal run cannot use fork preparation mode');
    if (goalRun?.resume && !resumeSessionId && !goalRun.forkRecovery) throw new TypeError('Native Goal resume requires an exact saved thread');
    if (goalRun && resumeSessionId && resumePolicy !== 'exact') {
      throw new TypeError('Native Goal runs require exact thread resume');
    }
    if (goalRun && resumeSessionId && !goalRun.expectedRevision) {
      throw new TypeError('Native Goal execution on a saved thread requires an expected revision');
    }
    const safePrompt = validatePrompt(prompt);
    let safeModel = validateModel(model);
    let safeReasoningEffort = validateReasoningEffort(reasoningEffort);
    const safeImageUrls = imageInputs(imageUrls).map((image) => image.url);
    if (!['fallback', 'exact'].includes(resumePolicy)) throw new TypeError('resumePolicy is invalid');
    if (typeof prepareForkGoal !== 'boolean' || typeof onForkPrepared !== 'function'
        || typeof onBeforeFork !== 'function') throw new TypeError('Fork preparation options are invalid');
    if (forkFrom !== null && (!forkFrom || typeof forkFrom !== 'object'
        || typeof forkFrom.threadId !== 'string' || !forkFrom.threadId.trim()
        || typeof forkFrom.lastTurnId !== 'string' || !forkFrom.lastTurnId.trim()
        || resumeSessionId)) throw new TypeError('Fork source is invalid');
    let plan;
    const taskPrompt = goalRun?.objective ?? safePrompt;
    let routedQuery = taskPrompt;
    let routingClassification = null;
    let activeWorkTask;
    let progressWorkTask;
    let checkpointMutable = false;
    let releaseWriteLease = () => {};
    let childStarted = false;
    let childClosed = false;
    let leaseReleaseError = null;
    try {
    let releasePreflight;
    const preflight = { cancelled: false, ready: new Promise((resolve) => { releasePreflight = resolve; }) };
    this.#preflights.set(key, preflight);
    let policy;
    try {
      const runtime = modelPolicy && !resumeSessionId ? null : await this.#probeRuntime({
        codexBin: this.#codexBin, cwd: workspace, env: this.#env, spawnImpl: this.#spawn, threadId: resumeSessionId });
      if (resumeSessionId && !runtime?.threadRoutingState)
        throw new Error("Cannot recover the previous task scope and capabilities. Retry history recovery or start a new session; no work was started.");
      const routing = prepareTurnRouting({ text: taskPrompt, newImages: safeImageUrls.length > 0,
        state: { ...runtime?.threadRoutingState, resumed: Boolean(resumeSessionId) } });
      routingClassification = routing.classification;
      routedQuery = routing.query;
      if (resumeSessionId && this.#defaultPlanning && !orchestrationPlan && routing.unknownContinuation)
        throw new Error("Cannot recover the previous task scope. Restate the task before resuming; no work was started.");
      plan = orchestrationPlan ?? this.#plan({ prompt: routing.query, workspace, routing });
      if (routing.classification === "ambiguous") plan = constrainReadOnlyPlan(plan);
      if (!writableRoots) writableRoots = Array.isArray(plan?.writeScope) ? constrainedWriteRoots(plan) : this.#defaultPlanning ? [] : [workspace];
      if (!writableRoots.length) readOnly = true;
      workspace = executionWorkspace(workspace, writableRoots, readOnly);
      const inheritActiveTask = shouldInheritActiveTask(routing);
      checkpointMutable = routing.classification === "continuation" || routing.classification === "development";
      progressWorkTask = resolveActiveRuntimeTask(workspace);
      activeWorkTask = inheritActiveTask ? progressWorkTask : null;
      if (resumeSessionId && !boundedContext) {
        boundedContext = routing.classification === "development"
          ? boundedRuntimeContext(routing.query, plan)
          : boundedFollowupContext(plan, {
            activeWorkTask,
            resumeCheckpoint: inheritActiveTask ? resumeCheckpoint : null,
            repositoryState: inheritActiveTask ? captureRepositoryCheckpoint(workspace) : null
          });
      }
      else if (!orchestrationPlan && this.#defaultPlanning && !boundedContext) boundedContext = boundedRuntimeContext(routing.query, plan);
      policy = freezeDecision(modelPolicy ?? selectTurnPolicy({ routing, plan, models: runtime.models, usage: runtime.usage,
        model: safeModel, effort: safeReasoningEffort,
        extraContextTokens: Math.ceil((buildDeveloperInstructions({ plan, activeWorkTask, progressWorkTask, usageGuardMode: this.#usageGuardMode }).length
          + (typeof boundedContext === "string" ? boundedContext.length : boundedContext ? JSON.stringify(boundedContext).length : 0)) / 4) }));
      try { await onModelPolicy(policy); } catch { /* Status sinks must not change execution. */ }
      try { await onProgress({ method: "bridge/modelPolicy", params: policy }); } catch { /* Best-effort status. */ }
      if (preflight.cancelled) throw new Error("Codex task stopped before model preflight completed.");
      if (policy.mode === "blocked" || !policy.coordinator?.model) {
        const error = new Error(`Codex model policy blocked this task: ${(policy.reasonCodes ?? []).join(", ")}`);
        error.code = "MODEL_POLICY_BLOCKED";
        error.modelPolicy = policy;
        throw error;
      }
      releaseWriteLease = acquireRuntimeWriteLease(goalRun ? (writableRoots.length ? writableRoots : [workspace])
        : (readOnly ? [] : writableRoots), { owner: key, lockDirectory: this.#leaseDirectory });
      safeModel = validateModel(policy.coordinator.model);
      safeReasoningEffort = validateReasoningEffort(policy.coordinator.effort);
    } catch (error) {
      this.#preflights.delete(key);
      releasePreflight();
      throw error;
    }

    return await new Promise((resolve, reject) => {
      let child;
      try {
        child = this.#spawn(this.#codexBin, ["app-server"], { cwd: workspace, env: this.#env, stdio: ["pipe", "pipe", "pipe"] });
        childStarted = true;
        child.once("close", () => {
          childClosed = true;
          try { releaseWriteLease(); } catch (error) { leaseReleaseError = error; }
        });
      } catch (error) {
        this.#preflights.delete(key);
        releasePreflight();
        reject(error);
        return;
      }

      let settled = false;
      let timedOut = false;
      let cancelled = false;
      let autoApproveAll = false;
      let threadId = resumeSessionId;
      let turnId = null;
      let workStarted = false;
      let lastAgentMessage = "";
      let actualModel = null;
      let usage = null;
      let compactionCount = 0;
      const seenCompactions = new Set();
      const anonymousCompactions = new Map();
      const identifiedCompactions = new Map();
      const usageGuard = createUsageGuard({ mode: this.#usageGuardMode });
      const pendingGuardEvents = [];
      const pendingCompactionEvents = [];
      const pendingCompletions = [];
      const pendingGoalEvents = new Map();
      const goalTurnGenerations = new Map();
      const completedGoalTurnIds = new Set();
      let pendingGoalEventCount = 0;
      let goalTurnGeneration = 0;
      let anonymousGoalEventId = 0;
      let turnStartPending = false;
      let guardTurnId = null;
      let goalController = null;
      let goalStatusRefresh = Promise.resolve();
      let goalPausePending = null;
      let goalStopBoundaryRequested = false;
      let budgetLimitedSupervisorWaiting = false;
      let goalBudgetMutationPending = false;
      let goalThreadPolicyVerified = false;
      let goalThreadPolicySnapshot = null;
      const outputImagePaths = new Set();
      const recordCompaction = event => {
        const params = event.params ?? {};
        const eventTurnId = params.turnId;
        const prefix = `turn:${eventTurnId}:`;
        const identity = params.item?.id ?? params.itemId ?? params.compactionId ?? params.id ?? null;
        if (identity) {
          const key = `${prefix}item:${identity}`;
          if (seenCompactions.has(key)) return false;
          seenCompactions.add(key);
          const pendingAnonymous = anonymousCompactions.get(eventTurnId) ?? 0;
          if (pendingAnonymous > 0) {
            anonymousCompactions.set(eventTurnId, pendingAnonymous - 1);
            return false;
          }
          identifiedCompactions.set(eventTurnId, (identifiedCompactions.get(eventTurnId) ?? 0) + 1);
        } else {
          const pendingIdentified = identifiedCompactions.get(eventTurnId) ?? 0;
          if (pendingIdentified > 0) {
            identifiedCompactions.set(eventTurnId, pendingIdentified - 1);
            return false;
          }
          anonymousCompactions.set(eventTurnId, (anonymousCompactions.get(eventTurnId) ?? 0) + 1);
        }
        compactionCount++;
        safeProgress(event);
        return true;
      };
      const queueGoalTurnEvent = event => {
        if (settled) return false;
        const params = event?.params ?? {};
        const eventTurnId = params.turnId;
        if (!goalController || params.threadId !== threadId || typeof eventTurnId !== 'string' || !eventTurnId
            || completedGoalTurnIds.has(eventTurnId) || goalTurnGenerations.has(eventTurnId)) return false;
        const eventList = pendingGoalEvents.get(eventTurnId) ?? [];
        let key;
        if (event.method === 'thread/tokenUsage/updated') key = `usage:${eventTurnId}`;
        else if (event.method === 'item/started' && params.item?.id) key = `item:${eventTurnId}:${params.item.id}`;
        else if (isCompactionEvent(event)) {
          const identity = params.item?.id ?? params.itemId ?? params.compactionId ?? params.id;
          key = identity ? `compaction:${eventTurnId}:${identity}` : `anonymous:${++anonymousGoalEventId}`;
        } else key = `anonymous:${++anonymousGoalEventId}`;
        const existingIndex = eventList.findIndex(entry => entry.key === key);
        if (existingIndex >= 0) {
          if (event.method === 'thread/tokenUsage/updated') {
            const prior = eventList[existingIndex].event;
            eventList[existingIndex] = { key, event: { ...event, params: { ...params,
              tokenUsage: mergeUsageSnapshots(prior.params?.tokenUsage, params.tokenUsage) } } };
          }
          return true;
        }
        if (pendingGoalEventCount >= MAX_PENDING_GOAL_EVENTS) {
          void fail(new Error('Too many unconfirmed native Goal turn events'));
          return false;
        }
        eventList.push({ key, event });
        pendingGoalEvents.set(eventTurnId, eventList);
        pendingGoalEventCount++;
        return true;
      };
      const flushGoalTurnEvents = eventTurnId => {
        const events = pendingGoalEvents.get(eventTurnId) ?? [];
        pendingGoalEventCount -= events.length;
        pendingGoalEvents.delete(eventTurnId);
        // Events buffered for other IDs are stale replay or out of sequence. A
        // single App Server stream cannot legitimately announce a later Goal
        // turn's usage before this turn has started.
        pendingGoalEvents.clear();
        pendingGoalEventCount = 0;
        for (const entry of events) {
          if (isCompactionEvent(entry.event)) recordCompaction(entry.event);
          else observeActiveTurnUsage(entry.event);
        }
      };
      let lastError = "";
      let stderr = "";
      let resetSavedSession = false;
      let nextRequestId = 0;
      const requests = new Map();
      const pendingApprovals = new Map();
      const pendingUserInputs = new Map();
      const pendingSteers = [];
      let steeringInFlight = false;

      const send = (message) => {
        if (child.stdin.destroyed || child.killed) return false;
        child.stdin.write(`${JSON.stringify(message)}\n`);
        return true;
      };
      const request = (method, params, handler = () => {}) => {
        const id = ++nextRequestId;
        requests.set(String(id), handler);
        if (!send({ method, id, params })) {
          requests.delete(String(id));
          throw new Error("Codex App Server is no longer running");
        }
        return id;
      };
      const requestResult = (method, params) => new Promise((resolve, reject) => {
        try {
          request(method, params, message => message.error
            ? reject(rpcError(message)) : resolve(message.result));
        } catch (error) { reject(error); }
      });
      const requestGoalResult = (method, params) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Object.assign(new Error('Native Goal RPC timed out; runtime recovery is required'), {
          code: 'GOAL_RPC_TIMEOUT'
        })), GOAL_RPC_TIMEOUT_MS);
        timeout.unref();
        requestResult(method, params).then(result => { clearTimeout(timeout); resolve(result); }, error => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      const getNativeGoal = async resolvedThreadId => {
        const result = await requestGoalResult('thread/goal/get', { threadId: resolvedThreadId });
        if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'goal')) {
          throw Object.assign(new Error('Native Goal read returned no explicit state; runtime recovery is required'), {
            code: 'GOAL_STATE_INVALID'
          });
        }
        const goal = result.goal;
        if (goal === undefined) throw Object.assign(new Error('Native Goal read returned an invalid empty state'), {
          code: 'GOAL_STATE_INVALID'
        });
        if (goal !== null && (!goal || typeof goal !== 'object' || Array.isArray(goal)
            || goal.threadId !== resolvedThreadId || typeof goal.objective !== 'string'
            || !['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'].includes(goal.status))) {
          throw Object.assign(new Error('Native Goal state is invalid or belongs to another thread'), { code: 'GOAL_STATE_INVALID' });
        }
        return goal;
      };
      const readPriorGoalTurnIds = async resolvedThreadId => {
        const ids = new Set();
        const cursors = new Set();
        let cursor = null;
        for (let page = 0; page < 103; page++) {
          const result = await requestGoalResult('thread/turns/list', {
            threadId: resolvedThreadId, cursor, limit: 5, itemsView: 'summary'
          });
          if (!result || !Array.isArray(result.data)) throw Object.assign(
            new Error('Prior native Goal turns could not be read safely; runtime recovery is required'),
            { code: 'GOAL_RECOVERY_REQUIRED' }
          );
          for (const turn of result.data) {
            if (!turn || typeof turn.id !== 'string' || !/^[a-zA-Z0-9_.:/-]{1,200}$/.test(turn.id)) {
              throw Object.assign(new Error('Prior native Goal turn identity is invalid'), { code: 'GOAL_RECOVERY_REQUIRED' });
            }
            ids.add(turn.id);
            if (ids.size > 512) throw Object.assign(
              new Error('Prior Goal turn history exceeds the safe recovery window'), { code: 'GOAL_RECOVERY_REQUIRED' }
            );
          }
          const nextCursor = result.nextCursor ?? null;
          if (nextCursor === null) return [...ids];
          if (typeof nextCursor !== 'string' || !nextCursor || nextCursor.length > 512 || cursors.has(nextCursor)) {
            throw Object.assign(new Error('Prior native Goal turn history cursor is invalid'), { code: 'GOAL_RECOVERY_REQUIRED' });
          }
          cursors.add(nextCursor);
          cursor = nextCursor;
        }
        throw Object.assign(new Error('Prior native Goal turn history did not reach a stable end'), {
          code: 'GOAL_RECOVERY_REQUIRED'
        });
      };
      const verifyGoalRevision = (goal, resolvedThreadId) => {
        if (goalRun?.expectedRevision
            && nativeGoalRevision(goal, resolvedThreadId) !== goalRun.expectedRevision) {
          throw Object.assign(new Error('Native Goal changed; refresh status before retrying'), {
            code: 'GOAL_REVISION_CONFLICT'
          });
        }
      };
      const verifyGoalThreadPolicy = response => {
        if (!goalRun) return;
        const expectedRoots = readOnly ? [] : writableRoots;
        const responseRoots = response?.runtimeWorkspaceRoots;
        const sandboxRoots = response?.sandbox?.writableRoots ?? [];
        const absoluteRoots = roots => Array.isArray(roots) && roots.every(root => typeof root === 'string' && path.isAbsolute(root))
          ? roots.map(root => path.resolve(root)).sort() : null;
        const normalizedExpectedRoots = absoluteRoots(expectedRoots);
        const normalizedResponseRoots = absoluteRoots(responseRoots);
        const normalizedSandboxRoots = absoluteRoots(sandboxRoots);
        const rootsMatch = Array.isArray(responseRoots)
          && normalizedResponseRoots?.join('\n') === normalizedExpectedRoots?.join('\n');
        const sandboxRootsWithinScope = normalizedSandboxRoots !== null
          && normalizedSandboxRoots.every(root => normalizedExpectedRoots?.some(allowedRoot => {
            const relative = path.relative(allowedRoot, root);
            return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
          }));
        const expectedSandbox = readOnly ? 'readOnly' : 'workspaceWrite';
        if (!response || response.model !== safeModel
            || (response.reasoningEffort ?? null) !== (safeReasoningEffort ?? null)
            || typeof response.cwd !== 'string' || path.resolve(response.cwd) !== path.resolve(workspace)
            || response.approvalPolicy !== 'on-request' || response.approvalsReviewer !== 'user'
            || response.sandbox?.type !== expectedSandbox || (response.sandbox.networkAccess ?? false) !== false
            || (response.sandbox.excludeSlashTmp ?? false) !== false
            || (response.sandbox.excludeTmpdirEnvVar ?? false) !== false
            || !rootsMatch || !sandboxRootsWithinScope) {
          throw Object.assign(new Error('Codex App Server applied a different or incomplete native Goal thread policy; no Goal was activated'), {
            code: 'GOAL_THREAD_POLICY_MISMATCH'
          });
        }
        goalThreadPolicySnapshot = {
          model: safeModel, effort: safeReasoningEffort ?? null, cwd: path.resolve(workspace),
          approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxType: expectedSandbox,
          sandboxNetworkAccess: response.sandbox.networkAccess ?? false,
          sandboxWritableRoots: normalizedSandboxRoots,
          excludeSlashTmp: response.sandbox.excludeSlashTmp === true,
          excludeTmpdirEnvVar: response.sandbox.excludeTmpdirEnvVar === true,
          runtimeWorkspaceRoots: normalizedResponseRoots
        };
        goalThreadPolicyVerified = true;
      };
      const activateGoalRun = async resolvedThreadId => {
        if (!goalRun) return false;
        const currentGoal = await getNativeGoal(resolvedThreadId);
        verifyGoalRevision(currentGoal, resolvedThreadId);
        if (goalRun.resume) {
          const resumableStatus = goalRun.resumeBudgetLimited
            ? currentGoal?.status === 'budgetLimited' : ['paused', 'blocked'].includes(currentGoal?.status);
          if (!currentGoal || !resumableStatus) {
            throw Object.assign(new Error('This native Goal is not in a safely resumable state'), { code: 'GOAL_NOT_RESUMABLE' });
          }
          if (goalRun.objective && currentGoal.objective !== goalRun.objective) {
            throw Object.assign(new Error('Resume objective does not match the native Goal'), { code: 'GOAL_OBJECTIVE_CONFLICT' });
          }
          if (goalRun.resumeBudgetLimited) {
            if (!Number.isSafeInteger(currentGoal.tokenBudget) || !Number.isSafeInteger(currentGoal.tokensUsed)) {
              throw Object.assign(new Error('Native Goal budget and usage are required for recovery'), { code: 'GOAL_USAGE_UNKNOWN' });
            }
            if (goalRun.tokenBudget <= currentGoal.tokenBudget || goalRun.tokenBudget <= currentGoal.tokensUsed) {
              throw Object.assign(new Error('New budget must exceed both the current budget and tokens used'), {
                code: 'GOAL_BUDGET_NOT_ABOVE_USAGE'
              });
            }
          }
        } else if (currentGoal && currentGoal.status !== 'complete') {
          throw Object.assign(new Error('A native Goal already exists for this thread'), { code: 'GOAL_ALREADY_EXISTS' });
        }
        const staleTurnIds = goalRun.resume ? await readPriorGoalTurnIds(resolvedThreadId) : [];
        goalController = createGoalRunController({ threadId: resolvedThreadId,
          initialStatus: goalRun.resumeBudgetLimited ? 'budgetLimited' : 'active', staleTurnIds });
        threadId = resolvedThreadId;
        turnStartPending = true;
        if (goalRun.resumeBudgetLimited) {
          // Transfer supervision to this exact resumed runtime before changing
          // the native budget. A runtime may start its next Goal turn as soon
          // as the new budget is accepted, so it must already be observable.
          budgetLimitedSupervisorWaiting = false;
          goalStopBoundaryRequested = false;
          goalBudgetMutationPending = true;
          goalController.observeStatus('active', resolvedThreadId);
          try {
            await requestGoalResult('thread/goal/set', { threadId: resolvedThreadId, tokenBudget: goalRun.tokenBudget });
            let updated = await getNativeGoal(resolvedThreadId);
            if (!updated || updated.threadId !== resolvedThreadId || updated.tokenBudget !== goalRun.tokenBudget
                || updated.objective !== currentGoal.objective || updated.tokensUsed !== currentGoal.tokensUsed
                || updated.timeUsedSeconds !== currentGoal.timeUsedSeconds || updated.createdAt !== currentGoal.createdAt
                || !['budgetLimited', 'active'].includes(updated.status)) {
              throw Object.assign(new Error('Native Goal budget recovery changed unrelated state'), { code: 'GOAL_READBACK_MISMATCH' });
            }
            if (updated.status === 'budgetLimited') {
              goalController.observeStatus('budgetLimited', resolvedThreadId);
              goalController.observeStatus('active', resolvedThreadId);
              await requestGoalResult('thread/goal/set', { threadId: resolvedThreadId, status: 'active' });
              updated = await getNativeGoal(resolvedThreadId);
            }
            if (!updated || updated.threadId !== resolvedThreadId || !['active', 'complete'].includes(updated.status)
                || updated.tokenBudget !== goalRun.tokenBudget || updated.objective !== currentGoal.objective
                || !Number.isSafeInteger(updated.tokensUsed) || updated.tokensUsed < currentGoal.tokensUsed
                || !Number.isSafeInteger(updated.timeUsedSeconds) || updated.timeUsedSeconds < currentGoal.timeUsedSeconds
                || updated.createdAt !== currentGoal.createdAt) {
              throw Object.assign(new Error('Native Goal recovery was not confirmed active with preserved usage'), { code: 'GOAL_READBACK_MISMATCH' });
            }
            if (updated.status === 'complete' && goalController.snapshot().turnsCompleted < 1) {
              throw Object.assign(new Error('Native Goal completed without a confirmed resumed turn'), { code: 'GOAL_STATE_INVALID' });
            }
            const observed = goalController.observeStatus(updated.status, resolvedThreadId);
            if (!observed.accepted) throw Object.assign(new Error('Native Goal recovery status could not be reconciled'), { code: 'GOAL_STATE_INVALID' });
            budgetLimitedSupervisorWaiting = false;
            emitGoalStatus(updated, observed.snapshot);
          } finally {
            goalBudgetMutationPending = false;
          }
          turnStartPending = false;
          for (const event of pendingGuardEvents.splice(0)) observeActiveTurnUsage(event);
          return true;
        }
        const params = goalRun.resume
          ? { threadId: resolvedThreadId, status: 'active' }
          : { threadId: resolvedThreadId, objective: goalRun.objective, status: 'active',
            ...(goalRun.tokenBudget === undefined ? {} : { tokenBudget: goalRun.tokenBudget }) };
        await requestGoalResult('thread/goal/set', params);
        const updated = await getNativeGoal(resolvedThreadId);
        if (!updated || (!goalRun.resume && updated.objective !== goalRun.objective)
            || (goalRun.tokenBudget !== undefined && updated.tokenBudget !== goalRun.tokenBudget)) {
          throw Object.assign(new Error('Native Goal activation did not match the requested state'), { code: 'GOAL_READBACK_MISMATCH' });
        }
        turnStartPending = false;
        for (const event of pendingGuardEvents.splice(0)) observeActiveTurnUsage(event);
        goalController.observeStatus(updated.status, resolvedThreadId);
        emitGoalStatus(updated);
        if (goalController.snapshot().canSettle) await settleNativeGoal();
        return true;
      };
      const notify = (method, params) => send({ method, params });
      const safeProgress = (event) => {
        Promise.resolve(onProgress(event)).catch(() => {});
      };
      const emitGoalStatus = (goal, snapshot = goalController?.snapshot()) => {
        if (!snapshot) return;
        safeProgress({ method: 'bridge/goalStatus', params: {
          status: goal?.status ?? snapshot.nativeStatus,
          state: snapshot.state,
          turnsSeen: snapshot.turnsSeen,
          turnsCompleted: snapshot.turnsCompleted,
          turnInFlight: snapshot.turnInFlight,
          ...(Number.isSafeInteger(goal?.tokenBudget) ? { tokenBudget: goal.tokenBudget } : {}),
          ...(Number.isSafeInteger(goal?.tokensUsed) ? { tokensUsed: goal.tokensUsed } : {}),
          ...(typeof turnId === 'string' ? { turnId } : {})
        } });
      };
      const steeringUnavailable = (detail = "Codex completed before the steering message could be applied.") => (
        new Error(`Codex task is no longer accepting steering input: ${detail}`)
      );
      const rejectPendingSteers = (error = steeringUnavailable()) => {
        while (pendingSteers.length > 0) {
          const pending = pendingSteers.shift();
          if (!pending.settled) {
            pending.settled = true;
            pending.reject(error);
          }
        }
      };
      const flushSteers = () => {
        if (settled || steeringInFlight || !threadId || !turnId || pendingSteers.length === 0) return;
        const pending = pendingSteers[0];
        steeringInFlight = true;
        try {
          request("turn/steer", turnSteerParams({
            threadId,
            expectedTurnId: turnId,
            prompt: pending.prompt,
            imageUrls: pending.imageUrls,
            clientUserMessageId: pending.clientUserMessageId
          }), (message) => {
            steeringInFlight = false;
            if (pendingSteers[0] === pending) pendingSteers.shift();
            if (pending.settled) return;
            pending.settled = true;
            if (message.error) {
              pending.reject(steeringUnavailable(rpcError(message).message));
            } else {
              const acceptedTurnId = message.result?.turnId;
              if (typeof acceptedTurnId !== "string" || acceptedTurnId !== turnId) {
                pending.reject(steeringUnavailable("Codex App Server did not confirm the active turn."));
              } else {
                pending.resolve(Object.freeze({ threadId, turnId: acceptedTurnId }));
              }
            }
            flushSteers();
          });
        } catch (error) {
          steeringInFlight = false;
          if (pendingSteers[0] === pending) pendingSteers.shift();
          if (!pending.settled) {
            pending.settled = true;
            pending.reject(steeringUnavailable(error instanceof Error ? error.message : String(error)));
          }
          flushSteers();
        }
      };
      const enqueueSteer = (input) => new Promise((resolve, reject) => {
        if (settled) {
          reject(steeringUnavailable());
          return;
        }
        pendingSteers.push({ ...input, resolve, reject, settled: false });
        flushSteers();
      });
      let termination;
      const terminateChild = () => {
        if (childClosed) return Promise.resolve();
        if (termination) return termination;
        const signalChild = signal => child.kill(signal);
        termination = new Promise((resolveStop, rejectStop) => {
          const force = setTimeout(() => { if (!childClosed) { try { signalChild("SIGKILL"); } catch {} } }, 2000);
          const deadline = setTimeout(() => rejectStop(new Error("App Server termination was not confirmed; workspace write lock retained until child close. Check local runtime state before manual cleanup.")), 4000);
          child.once("close", () => { clearTimeout(force); clearTimeout(deadline); resolveStop(); });
          try { if (!child.killed) signalChild("SIGTERM"); } catch { /* Escalation remains bounded; retain the lease without close evidence. */ }
        });
        return termination;
      };
      const finish = async (result) => {
        if (settled) return;
        result.message = ensureProgressPrefix(result.message, { progressWorkTask });
        result.usageSummary = { ...usageGuard.snapshot(), reportedModel: actualModel, requestedEffort: safeReasoningEffort };
        result.checkpointMutable = checkpointMutable;
        result.telemetry = createTurnTelemetry({ tokenUsage: usage, boundedContext, compactionCount });
        if (result.usageSummary.stopped) {
          result.exitCode = 1;
          const state = result.usageSummary;
          const detail = state.stopReason === 'context-limit'
            ? `Active-turn context ${state.peakContext} reached the local ${state.maxContextTokens}-token limit.`
            : `This task reached the local ${state.maxToolCalls}-tool-call limit.`;
          result.message = `Local task budget reached; task paused, not completed. ${detail} This is not an account quota error. Preserve changes and continue with a bounded task after reviewing evidence.\n` + (result.message ?? '');
        }
        settled = true;
        clearTimeout(timer);
        this.#runs.delete(key);
        rejectPendingSteers();
        try {
          await terminateChild();
          if (leaseReleaseError) throw leaseReleaseError;
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      const rejectPendingRequests = () => {
        const handlers = [...requests.values()];
        requests.clear();
        for (const handler of handlers) {
          try { handler({ error: { message: 'App Server closed before RPC response' } }); }
          catch { /* Each pending RPC owns its rejection handling. */ }
        }
      };
      const fail = async (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#runs.delete(key);
        rejectPendingRequests();
        rejectPendingSteers(steeringUnavailable(error instanceof Error ? error.message : String(error)));
        try { await terminateChild(); reject(leaseReleaseError ?? error); }
        catch (shutdownError) { reject(shutdownError); }
      };
      const settleNativeGoal = async () => {
        if (!goalController || settled || goalBudgetMutationPending || !goalController.snapshot().canSettle
            || pendingApprovals.size || pendingUserInputs.size) return false;
        const observed = await getNativeGoal(threadId);
        if (!observed) throw Object.assign(new Error('Native Goal disappeared before settlement; runtime recovery is required'), {
          code: 'GOAL_STATE_MISSING'
        });
        const statusResult = goalController.observeStatus(observed.status, threadId);
        if (!statusResult.accepted) throw Object.assign(new Error('Native Goal read-back could not be reconciled'), {
          code: 'GOAL_STATE_INVALID'
        });
        const snapshot = goalController.snapshot();
        if (!snapshot.canSettle || pendingApprovals.size || pendingUserInputs.size) return false;
        if (snapshot.nativeStatus === 'budgetLimited') {
          budgetLimitedSupervisorWaiting = true;
          goalStopBoundaryRequested = true;
          safeProgress({ method: 'bridge/goalStatus', params: { status: 'budgetLimited',
            state: 'budgetLimited', turnsSeen: snapshot.turnsSeen, turnsCompleted: snapshot.turnsCompleted } });
          return false;
        }
        const completed = snapshot.nativeStatus === 'complete';
        await finish({ exitCode: completed ? 0 : 1, signal: null, timedOut, sessionId: threadId,
          message: lastAgentMessage || (completed ? 'Native Goal completed.' : `Native Goal stopped with status ${snapshot.nativeStatus}.`),
          imagePaths: [...outputImagePaths], usage, model: actualModel,
          goal: { status: snapshot.nativeStatus, turnsSeen: snapshot.turnsSeen, turnsCompleted: snapshot.turnsCompleted } });
        return true;
      };
      const pauseGoal = async (expectedTurn = null) => {
        if (!goalController || settled) return false;
        if (expectedTurn && (expectedTurn.threadId !== threadId
            || expectedTurn.turnId !== (turnId ?? null)
            || expectedTurn.turnsSeen !== goalController.snapshot().turnsSeen)) {
          throw Object.assign(new Error('The active Goal turn changed after this control was rendered'), {
            code: 'GOAL_TURN_CONFLICT'
          });
        }
        goalStopBoundaryRequested = true;
        if (goalPausePending) return goalPausePending;
        goalPausePending = (async () => {
          const before = goalController.snapshot();
          if (before.nativeStatus === 'active') {
            await requestGoalResult('thread/goal/set', { threadId, status: 'paused' });
            const observed = await getNativeGoal(threadId);
            if (!observed || observed.status !== 'paused') {
              throw Object.assign(new Error('Native Goal pause was not confirmed'), { code: 'GOAL_READBACK_MISMATCH' });
            }
            goalController.observeStatus(observed.status, threadId);
            emitGoalStatus(observed);
          }
          for (const requestId of [...pendingApprovals.keys()]) respondApproval(requestId, 'decline');
          for (const [requestId, pending] of pendingUserInputs) {
            send({ id: pending.rpcId, error: { code: -32000, message: 'Goal paused before an answer was selected.' } });
            pendingUserInputs.delete(requestId);
          }
          if (turnId && goalController.snapshot().turnInFlight) {
            await requestGoalResult('turn/interrupt', { threadId, turnId });
          }
          if (budgetLimitedSupervisorWaiting && goalController.snapshot().nativeStatus === 'budgetLimited'
              && !goalController.snapshot().turnInFlight && !goalBudgetMutationPending) {
            const current = await getNativeGoal(threadId);
            if (!current || current.status !== 'budgetLimited') {
              throw Object.assign(new Error('Budget-limited Goal changed during stop; recovery is required'), {
                code: 'GOAL_RECOVERY_REQUIRED'
              });
            }
            await finish({ exitCode: 1, signal: null, timedOut, sessionId: threadId,
              message: 'Native Goal remains budgetLimited; supervisor stopped at the requested boundary.',
              imagePaths: [...outputImagePaths], usage, model: actualModel,
              goal: { status: 'budgetLimited', turnsSeen: goalController.snapshot().turnsSeen,
                turnsCompleted: goalController.snapshot().turnsCompleted } });
          } else if (goalController.snapshot().canSettle && !goalBudgetMutationPending) await settleNativeGoal();
          return goalController.snapshot();
        })().finally(() => { goalPausePending = null; });
        return goalPausePending;
      };
      const setGoalBudget = async (tokenBudget, expectedRevision) => {
        const before = goalController?.snapshot();
        if (!before || settled || before.nativeStatus !== 'budgetLimited'
            || before.turnInFlight || pendingApprovals.size || pendingUserInputs.size) {
          throw Object.assign(new Error('No waiting budget-limited Goal controller owns this thread'), {
            code: 'GOAL_BUDGET_SUPERVISOR_REQUIRED'
          });
        }
        budgetLimitedSupervisorWaiting = true;
        goalStopBoundaryRequested = true;
        if (!Number.isSafeInteger(tokenBudget) || tokenBudget < 1) throw new RangeError('Goal tokenBudget must be a positive safe integer');
        const current = await getNativeGoal(threadId);
        if (!current || current.status !== 'budgetLimited' || nativeGoalRevision(current, threadId) !== expectedRevision) {
          throw Object.assign(new Error('Native Goal changed; refresh status before retrying'), { code: 'GOAL_REVISION_CONFLICT' });
        }
        if (!Number.isSafeInteger(current.tokenBudget) || current.tokenBudget < 1) {
          throw Object.assign(new Error('Native Goal token budget is unavailable'), { code: 'GOAL_STATE_INVALID' });
        }
        if (!Number.isSafeInteger(current.tokensUsed)) {
          throw Object.assign(new Error('Native Goal token usage is unavailable'), { code: 'GOAL_USAGE_UNKNOWN' });
        }
        if (tokenBudget <= current.tokenBudget || tokenBudget <= current.tokensUsed) {
          throw Object.assign(new Error('New budget must exceed both the current budget and tokens used'), {
            code: 'GOAL_BUDGET_NOT_ABOVE_USAGE'
          });
        }
        goalBudgetMutationPending = true;
        goalStopBoundaryRequested = true;
        try {
          await requestGoalResult('thread/goal/set', { threadId, tokenBudget });
          const updated = await getNativeGoal(threadId);
          if (!updated || updated.tokenBudget !== tokenBudget || updated.objective !== current.objective
              || updated.tokensUsed !== current.tokensUsed || updated.timeUsedSeconds !== current.timeUsedSeconds
              || updated.createdAt !== current.createdAt
              || !['budgetLimited', 'active', 'paused', 'complete'].includes(updated.status)) {
            throw Object.assign(new Error('Native Goal budget update changed unrelated state'), { code: 'GOAL_READBACK_MISMATCH' });
          }
          const observed = goalController.observeStatus(updated.status, threadId);
          if (!observed.accepted) throw Object.assign(new Error('Native Goal status could not be reconciled'), { code: 'GOAL_STATE_INVALID' });
          if (updated.status === 'active') {
            await pauseGoal();
            const paused = await getNativeGoal(threadId);
            if (!paused || paused.status !== 'paused' || paused.tokenBudget !== tokenBudget
                || paused.objective !== current.objective || paused.tokensUsed !== current.tokensUsed
                || paused.timeUsedSeconds !== current.timeUsedSeconds || paused.createdAt !== current.createdAt) {
              throw Object.assign(new Error('Budget update activated Goal work that could not be stopped safely'), {
                code: 'GOAL_RECOVERY_REQUIRED'
              });
            }
            return true;
          }
          if (updated.status !== 'budgetLimited') await settleNativeGoal();
          return true;
        } catch (error) {
          if (!settled) void fail(error);
          throw error;
        } finally {
          goalBudgetMutationPending = false;
          const snapshot = goalController?.snapshot();
          if (!settled && snapshot?.canSettle && snapshot.nativeStatus !== 'budgetLimited') await settleNativeGoal();
        }
      };
      const resumeBudgetLimitedGoal = async expectedRevision => {
        const before = goalController?.snapshot();
        if (!before || settled || !budgetLimitedSupervisorWaiting || before.nativeStatus !== 'budgetLimited'
            || before.turnInFlight || pendingApprovals.size || pendingUserInputs.size) {
          throw Object.assign(new Error('No waiting budget-limited Goal controller owns this thread'), {
            code: 'GOAL_BUDGET_SUPERVISOR_REQUIRED'
          });
        }
        const current = await getNativeGoal(threadId);
        if (!current || current.status !== 'budgetLimited' || nativeGoalRevision(current, threadId) !== expectedRevision) {
          throw Object.assign(new Error('Native Goal changed; refresh status before retrying'), { code: 'GOAL_REVISION_CONFLICT' });
        }
        if (!Number.isSafeInteger(current.tokenBudget) || current.tokenBudget < 1) {
          throw Object.assign(new Error('Native Goal token budget is unavailable'), { code: 'GOAL_STATE_INVALID' });
        }
        if (!Number.isSafeInteger(current.tokensUsed)) {
          throw Object.assign(new Error('Native Goal token usage is unavailable'), { code: 'GOAL_USAGE_UNKNOWN' });
        }
        if (current.tokenBudget <= current.tokensUsed) {
          throw Object.assign(new Error('Increase the Goal budget explicitly before resuming'), { code: 'GOAL_BUDGET_CHANGE_REQUIRED' });
        }
        budgetLimitedSupervisorWaiting = false;
        goalStopBoundaryRequested = false;
        goalController.observeStatus('active', threadId);
        try {
          await requestGoalResult('thread/goal/set', { threadId, status: 'active' });
          const updated = await getNativeGoal(threadId);
          if (!updated || updated.status !== 'active' || updated.objective !== current.objective
              || updated.tokenBudget !== current.tokenBudget || updated.tokensUsed !== current.tokensUsed
              || updated.timeUsedSeconds !== current.timeUsedSeconds || updated.createdAt !== current.createdAt) {
            throw Object.assign(new Error('Native Goal resume was not confirmed active'), { code: 'GOAL_READBACK_MISMATCH' });
          }
          const observed = goalController.observeStatus(updated.status, threadId);
          if (!observed.accepted) throw Object.assign(new Error('Native Goal status could not be reconciled'), { code: 'GOAL_STATE_INVALID' });
          emitGoalStatus(updated, observed.snapshot);
          return true;
        } catch (error) {
          budgetLimitedSupervisorWaiting = true;
          goalStopBoundaryRequested = true;
          if (!settled) void fail(error);
          throw error;
        }
      };
      const startTurn = async (resolvedThreadId, fromSavedSession = false, beforeTurn = null) => {
        threadId = resolvedThreadId;
        if (threadId !== resumeSessionId) {
          try { await onSessionId(threadId); }
          catch {
            await fail(new Error(forkFrom
              ? 'The source conversation was forked, but its local ownership or session binding could not be persisted. The fork was preserved and no model turn was started; repair local state before retrying.'
              : 'Could not persist the new Codex session binding; no model turn was started'));
            return;
          }
        }
        if (beforeTurn) {
          try { await beforeTurn(threadId); }
          catch { await fail(new Error('Could not safely prepare the forked conversation; no model turn was started')); return; }
        }
        if (goalRun) {
          if (resumeSessionId && resumePolicy !== 'exact') {
            await fail(new Error('Native Goal runs require exact thread resume; fallback could bind the Goal to another thread'));
            return;
          }
          try { await activateGoalRun(threadId); }
          catch (error) { await fail(error); }
          return;
        }
        turnStartPending = true;
        request("turn/start", turnStartParams({
          threadId,
          workspace,
          prompt: boundedContext ? `${safePrompt}\n\nBounded context evidence:\n${typeof boundedContext === "string" ? boundedContext : JSON.stringify(boundedContext)}` : safePrompt,
          model: safeModel,
          reasoningEffort: safeReasoningEffort,
          imageUrls: safeImageUrls,
          writableRoots,
          readOnly
        }), (message) => {
          if (message.error) {
            turnStartPending = false;
            pendingGuardEvents.length = 0;
            pendingCompactionEvents.length = 0;
            pendingCompletions.length = 0;
            if (fromSavedSession && resumePolicy !== 'exact' && !resetSavedSession && !turnId && !workStarted && expiredSession(message)) {
              if (routingClassification === "ambiguous") {
                fail(new Error("The saved session expired and this request does not identify a bounded task. Restate the task; no new work was started."));
                return;
              }
              resetSavedSession = true;
              boundedContext = boundedRuntimeContext(routedQuery, plan);
              safeProgress({ method: "bridge/sessionReset", params: { reason: "The saved session expired before its turn could start." } });
              startNewThread();
              return;
            }
            fail(rpcError(message));
            return;
          }
          const resolvedTurnId = message.result?.turn?.id;
          if (typeof resolvedTurnId !== "string" || !resolvedTurnId) {
            fail(new Error("Codex App Server did not return an active turn ID"));
            return;
          }
          turnId = resolvedTurnId;
          guardTurnId = resolvedTurnId;
          turnStartPending = false;
          for (const event of pendingGuardEvents.splice(0)) observeActiveTurnUsage(event);
          for (const event of pendingCompactionEvents.splice(0)) {
            if (event.params?.threadId === threadId && event.params?.turnId === guardTurnId) {
              recordCompaction(event);
            }
          }
          for (const event of pendingCompletions.splice(0)) {
            if (event.params?.turn?.id === guardTurnId) completeConfirmedTurn(event);
          }
          flushSteers();
        });
      };
      const prepareForkTarget = async forkThreadId => {
        const currentGoal = (await requestResult('thread/goal/get', { threadId: forkThreadId }))?.goal;
        if (currentGoal?.status === 'active') {
          await requestResult('thread/goal/set', { threadId: forkThreadId, status: 'paused' });
        }
        await onForkPrepared(forkThreadId);
      };
      const startNewThread = () => {
        request("thread/start", threadStartParams({ workspace, model: safeModel,
          reasoningEffort: goalRun ? safeReasoningEffort : null,
          runtimeWorkspaceRoots: goalRun ? (readOnly ? [] : writableRoots) : null,
          modelPolicy: policy, orchestrationPlan: plan,
          activeWorkTask, progressWorkTask, writableRoots, readOnly, usageGuardMode: this.#usageGuardMode }), (message) => {
          if (message.error) {
            fail(rpcError(message));
            return;
          }
          const resolvedThreadId = message.result?.thread?.id;
          if (typeof resolvedThreadId !== "string" || !resolvedThreadId) {
            fail(new Error("Codex App Server did not return a thread ID"));
            return;
          }
          if (goalRun) {
            try { verifyGoalThreadPolicy(message.result); }
            catch (error) { void fail(error); return; }
          }
          actualModel = message.result?.model ?? message.result?.thread?.model ?? actualModel;
          void startTurn(resolvedThreadId);
        });
      };
      const startOrResumeThread = () => {
        if (forkFrom) {
          void Promise.resolve().then(() => onBeforeFork(Object.freeze({ ...forkFrom }))).then(() => {
            request('thread/fork', threadForkParams({ threadId: forkFrom.threadId, lastTurnId: forkFrom.lastTurnId,
              workspace, model: safeModel, modelPolicy: policy, orchestrationPlan: plan, activeWorkTask, progressWorkTask,
              writableRoots, readOnly, usageGuardMode: this.#usageGuardMode }), (message) => {
              if (message.error) { fail(rpcError(message)); return; }
              const resolvedThreadId = message.result?.thread?.id;
              actualModel = message.result?.thread?.model ?? actualModel;
              if (typeof resolvedThreadId !== 'string' || !resolvedThreadId || resolvedThreadId === forkFrom.threadId) {
                fail(new Error('Codex App Server did not return an isolated fork thread; no model turn was started'));
                return;
              }
              void startTurn(resolvedThreadId, false, prepareForkTarget);
            });
          }).catch(() => fail(new Error('The selected source could not be revalidated immediately before fork; no model turn was started')));
          return;
        }
        if (!resumeSessionId) {
          startNewThread();
          return;
        }
        const resume = () => request("thread/resume", threadResumeParams({ threadId: resumeSessionId, workspace, model: safeModel,
          reasoningEffort: goalRun ? safeReasoningEffort : null,
          runtimeWorkspaceRoots: goalRun ? (readOnly ? [] : writableRoots) : null,
          modelPolicy: policy, orchestrationPlan: plan,
          activeWorkTask, progressWorkTask, writableRoots, readOnly, usageGuardMode: this.#usageGuardMode,
          excludeTurns: resumePolicy === 'exact' }), (message) => {
          if (message.error) {
            if (!expiredSession(message)) { fail(rpcError(message)); return; }
            if (resumePolicy === 'exact' || routingClassification === "ambiguous") {
              fail(new Error("The saved session expired and this request does not identify a bounded task. Restate the task; no new work was started."));
              return;
            }
            resetSavedSession = true;
            boundedContext = boundedRuntimeContext(routedQuery, plan);
            safeProgress({ method: "bridge/sessionReset", params: { reason: "The saved session could not be resumed." } });
            startNewThread();
            return;
          }
          const resolvedThreadId = message.result?.thread?.id;
          if (typeof resolvedThreadId !== "string" || !resolvedThreadId) {
            fail(new Error("Codex App Server did not return a thread ID"));
            return;
          }
          if (resumePolicy === 'exact' && resolvedThreadId !== resumeSessionId) {
            fail(new Error('Codex App Server returned a different thread for exact resume; no model turn was started'));
            return;
          }
          if (goalRun) {
            try { verifyGoalThreadPolicy(message.result); }
            catch (error) { void fail(error); return; }
          }
          actualModel = message.result?.model ?? message.result?.thread?.model ?? actualModel;
          void startTurn(resolvedThreadId, true, prepareForkGoal ? prepareForkTarget : null);
        });
        if (goalRun) {
          void getNativeGoal(resumeSessionId).then(currentGoal => {
            verifyGoalRevision(currentGoal, resumeSessionId);
            if (currentGoal?.status === 'active') {
              throw Object.assign(new Error('An active native Goal cannot be resumed by a second runtime'), { code: 'GOAL_ALREADY_ACTIVE' });
            }
            resume();
          }).catch(fail);
        } else resume();
      };
      const answerUserInput = (requestId, answers) => {
        const pending = pendingUserInputs.get(String(requestId));
        if (!pending || settled || cancelled) return false;
        if (goalController && (pending.input.threadId !== threadId || pending.input.turnId !== turnId)) return false;
        let result;
        try { result = userInputResponse(pending.input, answers); } catch { return false; }
        if (!send({ id: pending.rpcId, result })) return false;
        pendingUserInputs.delete(String(requestId));
        if (goalController?.snapshot().canSettle) void settleNativeGoal().catch(fail);
        return true;
      };
      const respondApproval = (requestId, choice) => {
        const approval = pendingApprovals.get(String(requestId));
        if (!approval || settled) return false;
        if (goalController && (!guardTurnId || approval.threadId !== threadId || approval.turnId !== guardTurnId)) return false;
        let result;
        try {
          result = approvalResponse(approval, choice);
        } catch {
          return false;
        }
        pendingApprovals.delete(String(requestId));
        const accepted = send({ id: Number.isSafeInteger(Number(requestId)) ? Number(requestId) : requestId, result });
        if (accepted && goalController?.snapshot().canSettle) void settleNativeGoal().catch(fail);
        return accepted;
      };
      const enableAutoApproval = (requestId) => {
        const currentRequestId = String(requestId);
        const currentApproval = pendingApprovals.get(currentRequestId);
        if (!currentApproval || settled) return false;
        if (goalController && (!guardTurnId || currentApproval.threadId !== threadId || currentApproval.turnId !== guardTurnId)) return false;
        try {
          approvalResponse(currentApproval, "allow");
        } catch {
          return false;
        }

        autoApproveAll = true;
        for (const pendingRequestId of [...pendingApprovals.keys()]) {
          if (respondApproval(pendingRequestId, "allow")) {
            safeProgress({ method: "bridge/allPermissionsAutoApproved", params: { requestId: pendingRequestId } });
          }
        }
        return !pendingApprovals.has(currentRequestId);
      };
      const cancel = () => {
        if (settled || cancelled) return;
        cancelled = true;
        if (goalController) {
          void pauseGoal().catch(fail);
          return;
        }
        if (threadId && turnId) {
          try {
            request("turn/interrupt", { threadId, turnId });
          } catch {
            void terminateChild().catch(fail);
            return;
          }
          const shutdown = setTimeout(() => {
            if (!settled) void terminateChild().catch(fail);
          }, 2_000);
          shutdown.unref();
        } else {
          void terminateChild().catch(fail);
        }
      };
      const observeActiveTurnUsage = (event) => {
        if (settled) return;
        const params = event.params ?? {};
        if (params.threadId && params.threadId !== threadId) return;
        // Goal scheduler events can precede turn/started. Buffer only bounded,
        // exact-thread events with an explicit turn ID, then flush after the
        // controller accepts that turn. Ordinary resume replay keeps its old gate.
        if (!guardTurnId) {
          if (goalController && (event.method === 'thread/tokenUsage/updated' || event.method === 'item/started')) {
            queueGoalTurnEvent(event);
          } else if (turnStartPending && (event.method === 'thread/tokenUsage/updated' || event.method === 'item/started')) {
            if (pendingGuardEvents.length >= 256) { void fail(new Error('Too many unconfirmed turn usage events')); return; }
            pendingGuardEvents.push(event);
          }
          return;
        }
        if (goalController && params.turnId !== guardTurnId) {
          if (typeof params.turnId === 'string' && !goalTurnGenerations.has(params.turnId)
              && !completedGoalTurnIds.has(params.turnId)) queueGoalTurnEvent(event);
          return;
        }
        if (event.method === 'thread/tokenUsage/updated' || event.method === 'item/started') {
          // Both IDs are required by the App Server usage/item notification contracts.
          if (params.threadId !== threadId || params.turnId !== guardTurnId) return;
          if (event.method === 'thread/tokenUsage/updated') {
            usage = goalController ? mergeUsageSnapshots(usage, params.tokenUsage) : (params.tokenUsage ?? usage);
          }
        } else if (params.turnId && params.turnId !== guardTurnId) return;
        const generation = goalController ? goalTurnGenerations.get(guardTurnId) : null;
        const guardedEvent = goalController && event.method === 'thread/tokenUsage/updated'
          ? { ...event, params: { ...params, tokenUsage: usage } }
          : goalController && event.method === 'item/started' && typeof params.item?.id === 'string'
            ? { ...event, params: { ...params, item: { ...params.item, id: `${generation}:${params.item.id}` } } }
            : event;
        const guardEvent = usageGuard.observe(guardedEvent);
        if (guardEvent) {
          const checkpointEvent = { method: 'bridge/usageGuard', params: {
            ...guardEvent, threadId, turnId: guardTurnId, ...(generation ? { goalTurnGeneration: generation } : {}), checkpointMutable
          } };
          safeProgress(checkpointEvent);
          try { void Promise.resolve(onUsageCheckpoint({ ...checkpointEvent, workspace })).catch(() => {}); }
          catch { /* Checkpoint persistence is best effort and cannot affect the active turn. */ }
        }
        if (guardEvent?.action === 'stop') cancel();
      };
      const completeConfirmedTurn = (message) => {
        if (settled) return;
        const turn = message.params?.turn;
        if (goalController) {
          const observed = goalController.observe(message);
          if (!observed.accepted) {
            if (observed.reason !== 'foreign-thread') void fail(new Error('Native Goal turn lifecycle became ambiguous'));
            return;
          }
          if (observed.duplicate) return;
          const completedTurnId = message.params?.turnId ?? turn?.id;
          if (!guardTurnId || completedTurnId !== guardTurnId) {
            void fail(new Error('Native Goal completion did not match the active guarded turn'));
            return;
          }
        } else if (!guardTurnId) return;
        if ((message.params?.threadId && message.params.threadId !== threadId)
            || (turn?.id && turn.id !== guardTurnId)) return;
        const messageText = finalAgentMessage(turn) || lastAgentMessage || turn?.error?.message || lastError;
        generatedImagePaths(turn).forEach((imagePath) => outputImagePaths.add(imagePath));
        if (goalController) {
          lastAgentMessage = messageText || lastAgentMessage;
          completedGoalTurnIds.add(guardTurnId);
          const completedEvents = pendingGoalEvents.get(guardTurnId) ?? [];
          pendingGoalEventCount -= completedEvents.length;
          pendingGoalEvents.delete(guardTurnId);
          for (const requestId of [...pendingApprovals.keys()]) respondApproval(requestId, 'decline');
          for (const [requestId, pending] of pendingUserInputs) {
            send({ id: pending.rpcId, error: { code: -32000, message: 'The Goal turn ended before an answer was selected.' } });
            pendingUserInputs.delete(requestId);
          }
          autoApproveAll = false;
          guardTurnId = null;
          turnId = null;
          turnStartPending = false;
          const snapshot = goalController.snapshot();
          emitGoalStatus(null, snapshot);
          void settleNativeGoal().catch(fail);
          return;
        }
        void finish({
          exitCode: turn?.status === 'completed' ? 0 : 1,
          signal: null, timedOut, sessionId: threadId,
          message: messageText || (cancelled ? 'Codex task stopped.' : 'Codex returned no final message.'),
          imagePaths: [...outputImagePaths], usage, model: actualModel
        });
      };
      const run = { modelPolicy: policy, answerUserInput, cancel, pauseGoal, setGoalBudget, resumeBudgetLimitedGoal,
        approve: respondApproval, approveAll: enableAutoApproval, steer: enqueueSteer };
      this.#runs.set(key, run);
      this.#preflights.delete(key);
      releasePreflight();
      const timer = this.#maxRuntimeMs > 0
        ? setTimeout(() => {
          timedOut = true;
          cancel();
        }, this.#maxRuntimeMs)
        : null;

      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          if (goalRun) void fail(Object.assign(
            new Error('Malformed App Server frame during native Goal execution; recovery is required'),
            { code: 'GOAL_FRAME_INVALID' }
          ));
          return;
        }
        if (settled) return;
        if (isServerRequest(message)) {
          if (message.method === "item/tool/requestUserInput" || message.method === "tool/requestUserInput") {
            try {
              const input = userInputFromRequest(message);
              if (input.threadId !== threadId || input.turnId !== turnId || !onUserInput)
                throw new Error("User input is unavailable on this surface or turn");
              if (pendingUserInputs.size >= 8 || pendingUserInputs.has(input.requestId)) throw new Error("Too many pending questions");
              pendingUserInputs.set(input.requestId, { input, rpcId: message.id });
              Promise.resolve().then(() => {
                if (!settled && pendingUserInputs.has(input.requestId)) return onUserInput(input);
              }).catch(() => {
                if (!pendingUserInputs.delete(input.requestId) || settled) return;
                send({ id: message.id, error: { code: -32000, message: "This surface cannot present the requested input; no answer was selected." } });
              });
            } catch {
              send({ id: message.id, error: { code: -32602, message: "User input is unavailable or invalid; no answer was selected." } });
            }
            return;
          }
          const approval = approvalFromRequest(message);
          if (approval) {
            if (goalController && (!guardTurnId || approval.threadId !== threadId || approval.turnId !== guardTurnId)) {
              send({ id: message.id, error: { code: -32602, message: 'Approval is unavailable for this thread or turn.' } });
              return;
            }
            pendingApprovals.set(approval.requestId, approval);
            if (autoApproveAll && respondApproval(approval.requestId, "allow")) {
              safeProgress({ method: "bridge/allPermissionsAutoApproved", params: { requestId: approval.requestId } });
              return;
            }
            if (!readOnly && autoApproveGradle && isAutoApprovedGradleCompile(approval)) {
              pendingApprovals.delete(approval.requestId);
              const accepted = send({
                id: Number.isSafeInteger(Number(approval.requestId)) ? Number(approval.requestId) : approval.requestId,
                result: approvalResponse(approval, "allow")
              });
              if (!accepted) fail(new Error("Codex App Server is no longer running"));
              else safeProgress({ method: "bridge/gradleAutoApproved", params: {} });
              return;
            }
            safeProgress({ method: "bridge/approvalRequested", params: approval });
            Promise.resolve(onApproval(approval)).catch(() => respondApproval(approval.requestId, "decline"));
            return;
          }
          send({ id: message.id, error: { code: -32601, message: "TotemWorkspace runtime does not support this server request" } });
          return;
        }
        if (typeof message?.method === "string") {
          if (goalController && message.method === 'thread/goal/updated') {
            const params = message.params ?? {};
            if (params.threadId && params.goal?.threadId && params.threadId !== params.goal.threadId) {
              void fail(new Error('Native Goal status event has conflicting thread identity'));
              return;
            }
            const eventThreadId = params.threadId ?? params.goal?.threadId;
            if (eventThreadId !== threadId) {
              if (typeof eventThreadId !== 'string' || !eventThreadId)
                void fail(new Error('Native Goal status event is missing its thread identity'));
              return;
            }
            // Goal notifications are hints, not authoritative state. After a
            // runtime restart a delayed status event can belong to the prior
            // process; only a fresh native read may advance this controller.
            goalStatusRefresh = goalStatusRefresh.then(async () => {
              const currentGoal = await getNativeGoal(threadId);
              if (!currentGoal) throw Object.assign(new Error('Native Goal disappeared during status recovery'), {
                code: 'GOAL_STATE_MISSING'
              });
              const observed = goalController.observeStatus(currentGoal.status, threadId);
              if (!observed.accepted) throw new Error('Native Goal status read-back could not be reconciled');
              emitGoalStatus(currentGoal, observed.snapshot);
              if (budgetLimitedSupervisorWaiting && currentGoal.status === 'active' && !goalBudgetMutationPending) {
                await pauseGoal();
              } else if (observed.snapshot.canSettle && !goalBudgetMutationPending) await settleNativeGoal();
            }).catch(error => { void fail(error); });
            return;
          }
          if (goalRun && goalThreadPolicyVerified && message.method === 'thread/settings/updated') {
            const settings = message.params?.threadSettings;
            if (message.params?.threadId !== threadId) return;
            const settingsSandbox = settings?.sandboxPolicy;
            const settingsRoots = settingsSandbox?.writableRoots ?? [];
            const normalizedSettingsRoots = Array.isArray(settingsRoots)
                && settingsRoots.every(root => typeof root === 'string' && path.isAbsolute(root))
              ? settingsRoots.map(root => path.resolve(root)).sort() : null;
            const settingsRootsWithinScope = normalizedSettingsRoots !== null
              && normalizedSettingsRoots.every(root => goalThreadPolicySnapshot?.runtimeWorkspaceRoots.some(allowedRoot => {
                const relative = path.relative(allowedRoot, root);
                return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
              }));
            if (!goalThreadPolicySnapshot || !settings || settings.model !== goalThreadPolicySnapshot.model
                || (settings.effort ?? null) !== goalThreadPolicySnapshot.effort
                || typeof settings.cwd !== 'string' || path.resolve(settings.cwd) !== goalThreadPolicySnapshot.cwd
                || settings.approvalPolicy !== goalThreadPolicySnapshot.approvalPolicy
                || settings.approvalsReviewer !== goalThreadPolicySnapshot.approvalsReviewer
                || settingsSandbox?.type !== goalThreadPolicySnapshot.sandboxType
                || (settingsSandbox.networkAccess ?? false) !== goalThreadPolicySnapshot.sandboxNetworkAccess
                || !settingsRootsWithinScope
                || (settingsSandbox.excludeSlashTmp === true) !== goalThreadPolicySnapshot.excludeSlashTmp
                || (settingsSandbox.excludeTmpdirEnvVar === true) !== goalThreadPolicySnapshot.excludeTmpdirEnvVar) {
              void fail(new Error('Native Goal thread policy changed while the Goal was active; runtime recovery is required'));
            }
            return;
          }
          if (goalController && message.method === 'turn/started') {
            const turnParams = message.params ?? {};
            if (turnParams.threadId && turnParams.turn?.threadId
                && turnParams.threadId !== turnParams.turn.threadId) {
              void fail(new Error('Native Goal turn identity became ambiguous'));
              return;
            }
            const eventThreadId = turnParams.threadId ?? turnParams.turn?.threadId;
            if (eventThreadId !== threadId) {
              if (typeof eventThreadId !== 'string' || !eventThreadId) {
                void fail(new Error('Native Goal turn identity became ambiguous'));
              }
              return;
            }
            if (turnParams.turnId && turnParams.turn?.id && turnParams.turnId !== turnParams.turn.id) {
              void fail(new Error('Native Goal turn identity became ambiguous'));
              return;
            }
            const incomingTurnId = turnParams.turnId ?? turnParams.turn?.id;
            if (typeof incomingTurnId !== 'string' || !incomingTurnId) {
              void fail(new Error('Native Goal turn identity became ambiguous'));
              return;
            }
            if (goalController.isDuplicateTurnStart(incomingTurnId)) return;
            if (budgetLimitedSupervisorWaiting && goalController.snapshot().nativeStatus === 'budgetLimited') {
              goalController.observeStatus('active', threadId);
            }
            const observed = goalController.observe(message);
            if (!observed.accepted) {
              if (goalStopBoundaryRequested && observed.reason === 'turn-started-while-goal-not-active') {
                void fail(new Error('Native Goal started a new turn after the stop boundary; runtime recovery is required'));
                return;
              }
              if (observed.reason !== 'foreign-thread') void fail(new Error('Native Goal turn identity became ambiguous'));
              return;
            }
            if (observed.duplicate) return;
            if (budgetLimitedSupervisorWaiting && typeof incomingTurnId === 'string') {
              turnId = incomingTurnId;
              guardTurnId = incomingTurnId;
              goalTurnGeneration = observed.snapshot.turnsSeen;
              goalTurnGenerations.set(incomingTurnId, goalTurnGeneration);
              turnStartPending = false;
              workStarted = true;
              emitGoalStatus(null, observed.snapshot);
              void pauseGoal().catch(fail);
              return;
            }
            if (goalStopBoundaryRequested && typeof incomingTurnId === 'string'
                && !goalTurnGenerations.has(incomingTurnId)) {
              void fail(new Error('Native Goal started a new turn after the stop boundary; runtime recovery is required'));
              return;
            }
            const params = message.params ?? {};
            turnId = params.turnId ?? params.turn?.id;
            guardTurnId = turnId;
            goalTurnGeneration = observed.snapshot.turnsSeen;
            goalTurnGenerations.set(turnId, goalTurnGeneration);
            turnStartPending = false;
            workStarted = true;
            emitGoalStatus(null, observed.snapshot);
            actualModel = params.turn?.model ?? actualModel;
            for (const event of pendingGuardEvents.splice(0)) observeActiveTurnUsage(event);
            flushGoalTurnEvents(turnId);
          }
          if (goalController && message.method === 'turn/completed') {
            completeConfirmedTurn(message);
            return;
          }
          if (message.method === 'turn/completed' && !guardTurnId) {
            if (turnStartPending && (!message.params?.threadId || message.params.threadId === threadId)) {
              if (pendingCompletions.length >= 16) { void fail(new Error('Too many unconfirmed turn completions')); return; }
              pendingCompletions.push(message);
            }
            return;
          }
          if (isCompactionEvent(message)) {
            if (goalController) {
              const eventTurnId = message.params?.turnId;
              if (message.params?.threadId !== threadId || typeof eventTurnId !== 'string') return;
              if (eventTurnId === guardTurnId) recordCompaction(message);
              else queueGoalTurnEvent(message);
              return;
            }
            if (!guardTurnId) {
              if (turnStartPending && message.params?.threadId === threadId
                  && typeof message.params?.turnId === 'string') {
                if (pendingCompactionEvents.length >= 32) {
                  void fail(new Error('Too many unconfirmed compaction events'));
                  return;
                }
                pendingCompactionEvents.push(message);
              }
              return;
            }
            if (message.params?.threadId === threadId && message.params?.turnId === guardTurnId) {
              recordCompaction(message);
            }
            return;
          }
          if (message.method === "serverRequest/resolved") {
            pendingUserInputs.delete(String(message.params?.requestId));
            if (goalController?.snapshot().canSettle) void settleNativeGoal().catch(fail);
          }
          observeActiveTurnUsage(message);
          if (message.method === 'thread/tokenUsage/updated'
              && (!guardTurnId || message.params?.threadId !== threadId || message.params?.turnId !== guardTurnId)) return;
          if (message.method === "thread/started" || message.method === "turn/started") {
            actualModel = message.params?.turn?.model ?? message.params?.thread?.model ?? actualModel;
          }
          if (message.method === "turn/started" || message.method.startsWith("item/")) workStarted = true;
          if (message.method === "turn/started") {
            const notifiedThreadId = message.params?.threadId ?? message.params?.turn?.threadId;
            const notifiedTurnId = message.params?.turn?.id ?? message.params?.turnId;
            if ((!notifiedThreadId || notifiedThreadId === threadId) && typeof notifiedTurnId === "string" && notifiedTurnId) {
              turnId = notifiedTurnId;
              flushSteers();
            }
          }
          safeProgress(message);
          if (message.method === "item/completed") {
            const item = message.params?.item;
            if (item?.type === "agentMessage") lastAgentMessage = item.text?.trim() || lastAgentMessage;
            if (item?.type === "imageGeneration" && typeof item.savedPath === "string" && item.savedPath) {
              outputImagePaths.add(item.savedPath);
            }
          }
          if (message.method === "error") lastError = message.params?.error?.message ?? lastError;
          if (message.method === "turn/completed") {
            completeConfirmedTurn(message);
          }
          return;
        }
        if (Object.hasOwn(message ?? {}, "id")) {
          const handler = requests.get(String(message.id));
          if (!handler) return;
          requests.delete(String(message.id));
          try {
            handler(message);
          } catch (error) {
            fail(error);
          }
        }
      });
      child.stderr.on("data", (chunk) => { stderr = tail(`${stderr}${chunk}`); });
      child.once("error", fail);
      child.once("close", (exitCode, signal) => {
        if (settled) return;
        if (goalRun) {
          void fail(new Error('App Server closed before native Goal settlement; recovery is required'));
          return;
        }
        finish({
          exitCode,
          signal,
          timedOut,
          sessionId: threadId,
          message: stderr.trim() || (cancelled ? "Codex task stopped." : "Codex App Server stopped before completing the task."),
          imagePaths: [...outputImagePaths],
          usage, model: actualModel
        });
      });

      try {
        request("initialize", {
          clientInfo: { name: "totem_workspace", title: "TotemWorkspace", version: "0.1.0" },
          capabilities: { experimentalApi: true }
        }, (message) => {
          if (message.error) {
            fail(rpcError(message));
            return;
          }
          notify("initialized", {});
          startOrResumeThread();
        });
      } catch (error) {
        fail(error);
      }
    });
    } finally {
      if (!childStarted || childClosed) releaseWriteLease();
    }
  }
}
