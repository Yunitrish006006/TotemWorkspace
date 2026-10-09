#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  activeWorkItem,
  loadWorkCheckpoint,
  loadWorkRegistry,
  persistRuntimeWorkSettlement,
  resumeCheckpointForTask,
  validateWorkRegistry,
  workProgressPayload,
  workRegistrySummary
} from "../intelligence/work-registry.mjs";

const registry = loadWorkRegistry();
assert.equal(registry.schemaVersion, 1);
assert.deepEqual(validateWorkRegistry(registry), []);

const active = activeWorkItem(registry);
assert.ok(active);
assert.equal(active.id, registry.activeWorkId);
assert.ok(active.targetRepositories.some((entry) => entry.repository === "Yunitrish006006/TotemWorkspace"));
assert.ok(active.tasks.length >= 2);
if (active.status === "completed") {
  assert.equal(active.currentTaskId, null);
  assert.ok(active.tasks.every((task) => task.status === "completed"));
} else {
  assert.ok(active.tasks.some((task) => task.id === active.currentTaskId && task.status === "in-progress"));
}
assert.ok(active.tasks.every((task) => task.goal && task.primaryConcept && task.doneCriteria.length && task.stopBoundary));

const summary = workRegistrySummary(registry);
assert.equal(summary.activeWorkId, active.id);
assert.equal(summary.active.currentTaskId, active.currentTaskId);
assert.equal(summary.active.totalTasks, active.tasks.length);
assert.ok(summary.active.checkpoint?.summary);

const progress = workProgressPayload(registry);
assert.equal(progress.kind, "plan-state");
assert.equal(progress.activeWorkId, active.id);
assert.equal(progress.active.currentTaskId, active.currentTaskId);
assert.equal(progress.active.currentTask?.id ?? null, active.currentTaskId);
assert.equal(progress.active.completedTasks, active.tasks.filter((task) => task.status === "completed").length);
assert.equal(progress.active.totalTasks, active.tasks.length);
assert.ok(progress.active.completionPercent >= 0 && progress.active.completionPercent <= 100);
assert.equal(progress.active.milestones.length, active.milestones.length);

console.log(`Totem work registry validation passed: ${active.id}, current task ${active.currentTaskId}, ${summary.active.completedTasks}/${summary.active.totalTasks} completed.`);


const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "totem-work-registry-"));
try {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "data", "work-registry.json"), JSON.stringify({
    schemaVersion: 1,
    updatedAt: null,
    activeWorkId: "fixture",
    workItems: [{
      id: "fixture",
      title: "Fixture work",
      objective: "Validate automatic checkpoint persistence",
      status: "in-progress",
      targetRepositories: [{ repository: "Example/Repo", purpose: "fixture" }],
      currentTaskId: "T1",
      completedTaskIds: [],
      blockedBy: [],
      milestones: [{ id: "M1", title: "Fixture", tasks: ["T1", "T2"] }],
      tasks: [
        { id: "T1", title: "First", goal: "first", primaryConcept: "first", repository: "Example/Repo",
          status: "in-progress", dependsOn: [], doneCriteria: ["first done"], stopBoundary: "stop after first" },
        { id: "T2", title: "Second", goal: "second", primaryConcept: "second", repository: "Example/Repo",
          status: "planned", dependsOn: ["T1"], doneCriteria: ["second done"], stopBoundary: "stop after second" }
      ],
      checkpoint: { summary: "fixture start", currentTaskId: "T1", nextTask: "T1" }
    }]
  }, null, 2));

  const settled = persistRuntimeWorkSettlement(tempRoot, {
    runtimeTaskId: "runtime-1",
    state: "completed",
    repositoryState: { branch: "feature/fixture", head: "a".repeat(40), filesChanged: ["src/A.java"] },
    validation: [{ type: "command_completed", status: "success", summary: "focused validation passed" }]
  });
  assert.equal(settled.checkpoint.taskId, "T1");
  assert.equal(settled.checkpoint.nextTask, "T2");
  assert.deepEqual(settled.checkpoint.filesChanged, ["src/A.java"]);
  assert.equal(loadWorkRegistry(tempRoot).workItems[0].tasks.find((task) => task.id === "T1").status, "in-review");
  assert.equal(loadWorkRegistry(tempRoot).workItems[0].tasks.find((task) => task.id === "T2").status, "in-progress");
  assert.equal(loadWorkRegistry(tempRoot).workItems[0].currentTaskId, "T2");
  assert.equal(loadWorkCheckpoint(tempRoot).head, "a".repeat(40));
  assert.equal(resumeCheckpointForTask(tempRoot, "fixture", "T2")?.taskId, "T1");

  const blockedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "totem-work-registry-blocked-"));
  try {
    fs.cpSync(path.join(tempRoot, "data"), path.join(blockedRoot, "data"), { recursive: true });
    const blockedRegistry = JSON.parse(fs.readFileSync(path.join(blockedRoot, "data", "work-registry.json"), "utf8"));
    blockedRegistry.workItems[0].currentTaskId = "T2";
    blockedRegistry.workItems[0].tasks.find((task) => task.id === "T2").status = "in-progress";
    fs.writeFileSync(path.join(blockedRoot, "data", "work-registry.json"), JSON.stringify(blockedRegistry, null, 2));
    const blocked = persistRuntimeWorkSettlement(blockedRoot, {
      runtimeTaskId: "runtime-2",
      state: "failed",
      repositoryState: { branch: "feature/fixture", head: "b".repeat(40), filesChanged: [] },
      remainingRisks: ["fixture failure"]
    });
    assert.equal(blocked.checkpoint.state, "blocked");
    assert.equal(loadWorkRegistry(blockedRoot).workItems[0].tasks.find((task) => task.id === "T2").status, "blocked");
    assert.equal(loadWorkRegistry(blockedRoot).workItems[0].currentTaskId, "T2");
  } finally {
    fs.rmSync(blockedRoot, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const viewerSource = fs.readFileSync(new URL("./serve-local-viewer.mjs", import.meta.url), "utf8");
assert.ok(viewerSource.includes("persistRuntimeWorkSettlement(knowledge.root"), "Bridge must persist canonical progress when a runtime task settles");
assert.ok(viewerSource.includes("captureRepositoryCheckpoint(repositoryRoot)"), "Bridge must capture branch, HEAD and changed files for the checkpoint");
assert.ok(viewerSource.includes('pathname === "/api/work-progress"'), "Bridge must expose canonical work progress separately from runtime activity");
assert.ok(viewerSource.includes("workProgressPayload(loadWorkRegistry(ROOT))"), "Work progress API must derive from the canonical registry");
