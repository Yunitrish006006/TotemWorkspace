import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATUS = new Set(["planned", "in-progress", "blocked", "in-review", "completed", "cancelled"]);

function registryPath(root = ROOT) {
  return path.join(root, "data", "work-registry.json");
}

function checkpointPath(root = ROOT) {
  return path.join(root, ".totem-index", "work-checkpoint.json");
}

function cloneJson(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
  return value;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateWorkRegistry(registry) {
  const errors = [];
  if (registry?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!Array.isArray(registry?.workItems)) errors.push("workItems must be an array");
  const workItems = Array.isArray(registry?.workItems) ? registry.workItems : [];
  const workIds = workItems.map((item) => item?.id).filter(Boolean);
  if (new Set(workIds).size !== workIds.length) errors.push("work item ids must be unique");
  if (registry?.activeWorkId != null && !workIds.includes(registry.activeWorkId)) {
    errors.push("activeWorkId must reference an existing work item");
  }

  for (const item of workItems) {
    const prefix = nonEmpty(item?.id) ? item.id : "<work-item>";
    if (!nonEmpty(item?.id)) errors.push("work item id is required");
    if (!nonEmpty(item?.title)) errors.push(`${prefix}: title is required`);
    if (!nonEmpty(item?.objective)) errors.push(`${prefix}: objective is required`);
    if (!STATUS.has(item?.status)) errors.push(`${prefix}: invalid status`);
    if (!Array.isArray(item?.targetRepositories) || !item.targetRepositories.length) {
      errors.push(`${prefix}: targetRepositories must not be empty`);
    }
    for (const target of item?.targetRepositories ?? []) {
      if (!/^[^/\s]+\/[^/\s]+$/.test(target?.repository ?? "")) {
        errors.push(`${prefix}: target repository must use owner/name`);
      }
      if (!nonEmpty(target?.purpose)) errors.push(`${prefix}: target repository purpose is required`);
    }

    const tasks = Array.isArray(item?.tasks) ? item.tasks : [];
    const taskIds = tasks.map((task) => task?.id).filter(Boolean);
    if (!tasks.length) errors.push(`${prefix}: tasks must not be empty`);
    if (new Set(taskIds).size !== taskIds.length) errors.push(`${prefix}: task ids must be unique`);
    if (item?.currentTaskId != null && !taskIds.includes(item.currentTaskId)) {
      errors.push(`${prefix}: currentTaskId must reference a task`);
    }

    const completed = new Set(Array.isArray(item?.completedTaskIds) ? item.completedTaskIds : []);
    for (const id of completed) {
      const task = tasks.find((entry) => entry.id === id);
      if (!task) errors.push(`${prefix}: completedTaskIds contains unknown task ${id}`);
      else if (task.status !== "completed") errors.push(`${prefix}: completed task ${id} must have completed status`);
    }

    for (const task of tasks) {
      const taskPrefix = `${prefix}/${task?.id ?? "<task>"}`;
      for (const field of ["id", "title", "goal", "primaryConcept", "repository", "stopBoundary"]) {
        if (!nonEmpty(task?.[field])) errors.push(`${taskPrefix}: ${field} is required`);
      }
      if (!STATUS.has(task?.status)) errors.push(`${taskPrefix}: invalid status`);
      if (!Array.isArray(task?.doneCriteria) || !task.doneCriteria.length || task.doneCriteria.some((entry) => !nonEmpty(entry))) {
        errors.push(`${taskPrefix}: doneCriteria must contain at least one non-empty criterion`);
      }
      for (const dependency of task?.dependsOn ?? []) {
        if (!taskIds.includes(dependency)) errors.push(`${taskPrefix}: unknown dependency ${dependency}`);
        if (dependency === task.id) errors.push(`${taskPrefix}: task cannot depend on itself`);
      }
    }

    const milestoneTaskIds = (item?.milestones ?? []).flatMap((milestone) => milestone?.tasks ?? []);
    for (const id of milestoneTaskIds) {
      if (!taskIds.includes(id)) errors.push(`${prefix}: milestone references unknown task ${id}`);
    }

    if (item?.checkpoint) {
      if (item.checkpoint.currentTaskId !== item.currentTaskId) {
        errors.push(`${prefix}: checkpoint currentTaskId must match currentTaskId`);
      }
      if (!nonEmpty(item.checkpoint.summary)) errors.push(`${prefix}: checkpoint summary is required`);
      if (item.checkpoint.nextTask != null && !nonEmpty(item.checkpoint.nextTask)) {
        errors.push(`${prefix}: checkpoint nextTask must be null or a non-empty task id`);
      }
    }
  }
  return Object.freeze(errors);
}

export function loadWorkRegistry(root = ROOT) {
  const parsed = JSON.parse(fs.readFileSync(registryPath(root), "utf8"));
  const errors = validateWorkRegistry(parsed);
  if (errors.length) throw new Error(`Invalid work registry:\n- ${errors.join("\n- ")}`);
  return Object.freeze(parsed);
}

export function activeWorkItem(registry = loadWorkRegistry()) {
  return registry.workItems.find((item) => item.id === registry.activeWorkId) ?? null;
}

export function workRegistrySummary(registry = loadWorkRegistry()) {
  const active = activeWorkItem(registry);
  if (!active) return Object.freeze({ activeWorkId: null, active: null });
  const completed = active.tasks.filter((task) => task.status === "completed").length;
  return Object.freeze({
    activeWorkId: active.id,
    active: Object.freeze({
      title: active.title,
      objective: active.objective,
      status: active.status,
      currentTaskId: active.currentTaskId,
      completedTasks: completed,
      totalTasks: active.tasks.length,
      targetRepositories: Object.freeze(active.targetRepositories.map((entry) => entry.repository)),
      blockedBy: Object.freeze([...(active.blockedBy ?? [])]),
      checkpoint: active.checkpoint ?? null
    })
  });
}


export function saveWorkRegistry(root = ROOT, registry) {
  const errors = validateWorkRegistry(registry);
  if (errors.length) throw new Error(`Invalid work registry:\n- ${errors.join("\n- ")}`);
  writeJsonAtomic(registryPath(root), registry);
  return Object.freeze(cloneJson(registry));
}

export function loadWorkCheckpoint(root = ROOT) {
  try {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath(root), "utf8"));
    return checkpoint?.schemaVersion === 1 ? Object.freeze(checkpoint) : null;
  } catch {
    return null;
  }
}

export function recordWorkCheckpoint(root = ROOT, checkpoint = {}) {
  const boundedStrings = (values, limit) => Object.freeze((values ?? [])
    .filter((value) => typeof value === "string" && value.trim())
    .slice(0, limit)
    .map((value) => value.trim().slice(0, 512)));
  const validation = Object.freeze((checkpoint.validation ?? []).slice(0, 40).map((entry) => Object.freeze({
    type: String(entry?.type ?? "validation").slice(0, 80),
    status: String(entry?.status ?? "unknown").slice(0, 80),
    summary: String(entry?.summary ?? "").slice(0, 500)
  })));
  const stored = {
    schemaVersion: 1,
    updatedAt: checkpoint.updatedAt ?? new Date().toISOString(),
    workId: checkpoint.workId ?? null,
    taskId: checkpoint.taskId ?? null,
    runtimeTaskId: checkpoint.runtimeTaskId ?? null,
    state: checkpoint.state ?? null,
    repository: checkpoint.repository ?? null,
    branch: checkpoint.branch ?? null,
    head: checkpoint.head ?? null,
    filesChanged: boundedStrings(checkpoint.filesChanged, 120),
    validation,
    remainingRisks: boundedStrings(checkpoint.remainingRisks, 40),
    nextTask: checkpoint.nextTask ?? null,
    summary: typeof checkpoint.summary === "string" ? checkpoint.summary.slice(0, 1000) : null
  };
  writeJsonAtomic(checkpointPath(root), stored);
  return Object.freeze(stored);
}

function gitText(repositoryRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"]
  });
  return result.status === 0 ? String(result.stdout ?? "").trim() : "";
}

export function captureRepositoryCheckpoint(repositoryRoot) {
  const branch = gitText(repositoryRoot, ["branch", "--show-current"]) || null;
  const head = gitText(repositoryRoot, ["rev-parse", "HEAD"]) || null;
  const filesChanged = gitText(repositoryRoot, ["status", "--porcelain=v1"])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").at(-1)?.trim())
    .filter(Boolean)
    .slice(0, 120);
  return Object.freeze({ branch, head, filesChanged: Object.freeze(filesChanged) });
}

function nextRunnableTask(work) {
  const byId = new Map((work.tasks ?? []).map((task) => [task.id, task]));
  return (work.tasks ?? []).find((task) => task.status === "planned"
    && (task.dependsOn ?? []).every((id) => ["completed", "in-review"].includes(byId.get(id)?.status))) ?? null;
}

export function persistRuntimeWorkSettlement(root = ROOT, {
  runtimeTaskId = null,
  state,
  repositoryState = {},
  validation = [],
  remainingRisks = []
} = {}) {
  const registry = cloneJson(loadWorkRegistry(root));
  const work = registry.workItems.find((item) => item.id === registry.activeWorkId) ?? null;
  const task = work?.tasks?.find((entry) => entry.id === work.currentTaskId) ?? null;
  if (!work || !task) return Object.freeze({ registry: Object.freeze(registry), checkpoint: null, advanced: false });

  const successful = state === "completed";
  let next = null;
  if (successful) {
    if (task.status === "in-progress") task.status = "in-review";
    next = nextRunnableTask(work);
    if (next) {
      next.status = "in-progress";
      work.currentTaskId = next.id;
    }
  } else {
    task.status = "blocked";
  }

  const checkpoint = recordWorkCheckpoint(root, {
    workId: work.id,
    taskId: task.id,
    runtimeTaskId,
    state: successful ? "in-review" : "blocked",
    repository: task.repository,
    branch: repositoryState.branch ?? null,
    head: repositoryState.head ?? null,
    filesChanged: repositoryState.filesChanged ?? [],
    validation,
    remainingRisks: successful ? remainingRisks : [
      ...remainingRisks,
      "Runtime task did not complete successfully."
    ],
    nextTask: successful ? next?.id ?? null : task.id,
    summary: successful
      ? `${task.id} runtime work completed and is awaiting review${next ? `; ${next.id} is prepared as the next micro-task` : ""}.`
      : `${task.id} runtime work is blocked and requires resolution before continuing.`
  });

  work.checkpoint = {
    summary: checkpoint.summary,
    currentTaskId: work.currentTaskId,
    branch: checkpoint.branch,
    head: checkpoint.head,
    filesChanged: checkpoint.filesChanged,
    validation: checkpoint.validation,
    remainingRisks: checkpoint.remainingRisks,
    nextTask: checkpoint.nextTask
  };
  registry.updatedAt = checkpoint.updatedAt;
  saveWorkRegistry(root, registry);
  return Object.freeze({
    registry: Object.freeze(registry),
    checkpoint,
    advanced: successful && Boolean(next)
  });
}

export function resumeCheckpointForTask(root = ROOT, workId, taskId) {
  const checkpoint = loadWorkCheckpoint(root);
  if (!checkpoint || checkpoint.workId !== workId) return null;
  if (checkpoint.taskId !== taskId && checkpoint.nextTask !== taskId) return null;
  return checkpoint;
}
