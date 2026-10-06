#!/usr/bin/env node
import assert from "node:assert/strict";
import { activeWorkItem, loadWorkRegistry, validateWorkRegistry, workRegistrySummary } from "../intelligence/work-registry.mjs";

const registry = loadWorkRegistry();
assert.equal(registry.schemaVersion, 1);
assert.deepEqual(validateWorkRegistry(registry), []);

const active = activeWorkItem(registry);
assert.ok(active);
assert.equal(active.id, registry.activeWorkId);
assert.ok(active.targetRepositories.some((entry) => entry.repository === "Yunitrish006006/TotemWorkspace"));
assert.ok(active.tasks.length >= 2);
assert.ok(active.tasks.some((task) => task.id === active.currentTaskId && task.status === "in-progress"));
assert.ok(active.tasks.every((task) => task.goal && task.primaryConcept && task.doneCriteria.length && task.stopBoundary));

const summary = workRegistrySummary(registry);
assert.equal(summary.activeWorkId, active.id);
assert.equal(summary.active.currentTaskId, active.currentTaskId);
assert.equal(summary.active.totalTasks, active.tasks.length);
assert.ok(summary.active.checkpoint?.summary);

console.log(`Totem work registry validation passed: ${active.id}, current task ${active.currentTaskId}, ${summary.active.completedTasks}/${summary.active.totalTasks} completed.`);
