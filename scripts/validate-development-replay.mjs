#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendReplayEvent,
  loadDevelopmentReplay,
  recordReplayCheckpoint,
  replayActivityTail,
  replayFramePayload,
  replayTimelinePayload,
  replayVerificationStateAt
} from "../intelligence/development-replay.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "totem-replay-"));

function event(sequence, type, extra = {}) {
  return {
    sequence,
    timestamp: `2026-09-05T00:00:${String(sequence).padStart(2, "0")}Z`,
    type,
    source: "fixture",
    ...extra
  };
}

try {
  appendReplayEvent(root, event(1, "prompt_submitted", {
    summary: "inspect alchemy"
  }));
  appendReplayEvent(root, event(2, "task_started", {
    taskId: "task:fixture:1",
    moduleId: "totem-alchemy",
    featureId: "totem-alchemy.feature-1",
    summary: "Codex task started"
  }));
  appendReplayEvent(root, event(3, "file_edit", {
    taskId: "task:fixture:1",
    moduleId: "totem-alchemy",
    file: "src/main/java/example/Brewing.java"
  }));
  appendReplayEvent(root, event(4, "test_started", {
    taskId: "task:fixture:1",
    moduleId: "totem-alchemy",
    test: "src/test/java/example/BrewingGameTest.java"
  }));
  appendReplayEvent(root, event(5, "test_failed", {
    taskId: "task:fixture:1",
    moduleId: "totem-alchemy",
    test: "src/test/java/example/BrewingGameTest.java",
    summary: "fixture failed"
  }));
  recordReplayCheckpoint(root, {
    sequence: 5,
    changeIntelligence: {
      affectedEntityIds: ["component:totem-alchemy:brewing"],
      impact: { impactedModules: ["totem-alchemy"] }
    },
    graphState: {
      schemaVersion: 5,
      entityIds: ["totem-alchemy", "totem-alchemy.feature-1"],
      relations: []
    }
  });
  appendReplayEvent(root, event(6, "commit_created", {
    taskId: "task:fixture:1",
    moduleId: "totem-alchemy",
    summary: "abc1234 replay fixture"
  }));
  appendReplayEvent(root, event(7, "pr_created", {
    taskId: "task:fixture:1",
    moduleId: "totem-alchemy",
    summary: "PR #99"
  }));
  appendReplayEvent(root, event(8, "task_completed", {
    taskId: "task:fixture:1",
    moduleId: "totem-alchemy",
    summary: "done"
  }));
  appendReplayEvent(root, event(9, "deployment_started", {
    moduleId: "totem-alchemy",
    summary: "Modrinth publish"
  }));
  appendReplayEvent(root, event(10, "deployment_completed", {
    moduleId: "totem-alchemy",
    summary: "Modrinth publish complete"
  }));

  const persisted = loadDevelopmentReplay(root);
  assert.equal(persisted.latestSequence, 10);
  assert.equal(persisted.events.length, 10);
  assert.equal(persisted.sessions.length, 1);
  assert.equal(persisted.sessions[0].id, "session:task:fixture:1");
  assert.equal(persisted.sessions[0].state, "completed");
  assert.equal(persisted.sessions[0].startedSequence, 2);
  assert.equal(persisted.sessions[0].endedSequence, 8);
  assert.equal(persisted.sessions[0].milestoneCount, 2);

  const restored = replayActivityTail(root, { limit: 4 });
  assert.equal(restored.latestSequence, 10);
  assert.deepEqual(restored.events.map((entry) => entry.sequence), [7, 8, 9, 10]);

  const beforeFailure = replayVerificationStateAt(root, 4);
  assert.equal(beforeFailure.entries.length, 1);
  assert.equal(beforeFailure.entries[0].status, "running");

  const afterFailure = replayVerificationStateAt(root, 5);
  assert.equal(afterFailure.entries.length, 1);
  assert.equal(afterFailure.entries[0].status, "failed");

  const beforeTest = replayVerificationStateAt(root, 3);
  assert.equal(beforeTest.entries.length, 0);

  const frame4 = replayFramePayload(root, 4);
  assert.equal(frame4.sequence, 4);
  assert.equal(frame4.live, false);
  assert.equal(frame4.activity.type, "test_started");
  assert.equal(frame4.changeIntelligence, null, "checkpoint after sequence 4 must not leak backward");

  const frame5 = replayFramePayload(root, 5);
  assert.deepEqual(frame5.changeIntelligence.affectedEntityIds, ["component:totem-alchemy:brewing"]);
  assert.equal(frame5.graphState.schemaVersion, 5);

  const live = replayFramePayload(root, 9999);
  assert.equal(live.sequence, 10);
  assert.equal(live.latestSequence, 10);
  assert.equal(live.live, true);
  assert.equal(live.activity.type, "deployment_completed");

  const timeline = replayTimelinePayload(root);
  assert.equal(timeline.eventCount, 10);
  assert.equal(timeline.earliestSequence, 1);
  assert.equal(timeline.latestSequence, 10);
  assert.equal(timeline.sessions.length, 1);
  assert.deepEqual(
    timeline.milestones.map((entry) => entry.type),
    ["commit_created", "pr_created", "deployment_started", "deployment_completed"]
  );
  assert.deepEqual(
    timeline.sessions[0].milestones.map((entry) => entry.type),
    ["commit_created", "pr_created"]
  );

  // Loading from disk again is the restart contract: sequence/session state survives process memory loss.
  const reloaded = loadDevelopmentReplay(root);
  assert.equal(reloaded.latestSequence, 10);
  assert.equal(reloaded.sessions[0].state, "completed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const server = fs.readFileSync(new URL("./serve-local-viewer.mjs", import.meta.url), "utf8");
const verification = fs.readFileSync(new URL("../intelligence/verification-state.mjs", import.meta.url), "utf8");

for (const fragment of [
  'pathname === "/api/replay"',
  'pathname === "/api/replay/frame"',
  "replayActivityTail(ROOT",
  "appendReplayEvent(ROOT, event)",
  "recordReplayCheckpoint(knowledge.root",
  "replayVerificationStateAt(knowledge.root",
  "replaySchemaVersion: 1",
]) {
  assert.ok(server.includes(fragment), `Bridge Phase 6 integration missing: ${fragment}`);
}
assert.ok(
  verification.includes("verificationStatePayloadFromState"),
  "historical verification payload must be reconstructable without mutating live verification state"
);

console.log("Phase 6 replay validation passed: durable sequence/session restore, checkpointed change state, historical verification folding, and commit/PR/deployment milestones are reconstructable by sequence.");
