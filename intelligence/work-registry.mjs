import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATUS = new Set(["planned", "in-progress", "blocked", "in-review", "completed", "cancelled"]);

function registryPath(root = ROOT) {
  return path.join(root, "data", "work-registry.json");
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
      if (!nonEmpty(item.checkpoint.nextTask)) errors.push(`${prefix}: checkpoint nextTask is required`);
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
