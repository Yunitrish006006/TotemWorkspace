import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 1;
const EVENT_LIMIT = 10000;
const SESSION_LIMIT = 250;
const CHECKPOINT_LIMIT = 1200;
const MILESTONE_TYPES = new Set([
  "commit_created",
  "pr_created",
  "pr_merged",
  "deployment_started",
  "deployment_completed",
  "deployment_failed"
]);
const TERMINAL_TASK_TYPES = new Set(["task_completed", "task_failed"]);
const TEST_STATUS = Object.freeze({
  test_started: "running",
  test_passed: "passed",
  test_failed: "failed"
});

function replayPath(workspaceRoot) {
  return path.join(workspaceRoot, ".totem-index", "development-replay.json");
}

function emptyReplay() {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: null,
    latestSequence: 0,
    events: [],
    sessions: [],
    checkpoints: []
  };
}

function cloneJson(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function normalizeReplay(parsed) {
  if (parsed?.schemaVersion !== SCHEMA_VERSION) return emptyReplay();
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    latestSequence: Number.isFinite(parsed.latestSequence) ? Math.max(0, Math.floor(parsed.latestSequence)) : 0,
    events: Array.isArray(parsed.events) ? parsed.events : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    checkpoints: Array.isArray(parsed.checkpoints) ? parsed.checkpoints : []
  };
}

export function loadDevelopmentReplay(workspaceRoot) {
  try {
    return normalizeReplay(JSON.parse(fs.readFileSync(replayPath(workspaceRoot), "utf8")));
  } catch {
    return emptyReplay();
  }
}

function saveDevelopmentReplay(workspaceRoot, state) {
  const filePath = replayPath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
  return state;
}

function sessionIdForTask(taskId) {
  return taskId ? `session:${taskId}` : null;
}

function findSession(state, event) {
  if (event.taskId) {
    const id = sessionIdForTask(event.taskId);
    return state.sessions.find((session) => session.id === id) ?? null;
  }
  return state.sessions.findLast?.((session) => session.state === "running") ??
    [...state.sessions].reverse().find((session) => session.state === "running") ??
    null;
}

function ensureTaskSession(state, event) {
  if (!event.taskId) return findSession(state, event);
  const id = sessionIdForTask(event.taskId);
  let session = state.sessions.find((entry) => entry.id === id);
  if (!session) {
    session = {
      id,
      taskId: event.taskId,
      state: "running",
      startedSequence: event.sequence,
      endedSequence: null,
      startedAt: event.timestamp,
      endedAt: null,
      moduleId: event.moduleId ?? null,
      featureId: event.featureId ?? null,
      summary: event.summary ?? null,
      eventCount: 0,
      milestoneCount: 0
    };
    state.sessions.push(session);
  }
  return session;
}

export function appendReplayEvent(workspaceRoot, event) {
  const state = loadDevelopmentReplay(workspaceRoot);
  const stored = cloneJson(event);
  const session = event.type === "task_started"
    ? ensureTaskSession(state, event)
    : findSession(state, event);

  if (session) {
    stored.sessionId = session.id;
    session.eventCount = Number(session.eventCount ?? 0) + 1;
    if (!session.moduleId && event.moduleId) session.moduleId = event.moduleId;
    if (!session.featureId && event.featureId) session.featureId = event.featureId;
    if (MILESTONE_TYPES.has(event.type)) {
      session.milestoneCount = Number(session.milestoneCount ?? 0) + 1;
    }
    if (TERMINAL_TASK_TYPES.has(event.type)) {
      session.state = event.type === "task_completed" ? "completed" : "failed";
      session.endedSequence = event.sequence;
      session.endedAt = event.timestamp;
    }
  }

  state.latestSequence = Math.max(state.latestSequence, Number(event.sequence ?? 0));
  state.updatedAt = event.timestamp ?? new Date().toISOString();
  state.events.push(stored);
  if (state.events.length > EVENT_LIMIT) {
    state.events.splice(0, state.events.length - EVENT_LIMIT);
  }
  if (state.sessions.length > SESSION_LIMIT) {
    state.sessions.splice(0, state.sessions.length - SESSION_LIMIT);
  }
  saveDevelopmentReplay(workspaceRoot, state);
  return Object.freeze(stored);
}

export function recordReplayCheckpoint(workspaceRoot, {
  sequence,
  timestamp = new Date().toISOString(),
  changeIntelligence = null,
  graphState = null
} = {}) {
  const value = Number(sequence);
  if (!Number.isFinite(value) || value < 0) return null;
  const state = loadDevelopmentReplay(workspaceRoot);
  const checkpoint = {
    sequence: Math.floor(value),
    timestamp,
    changeIntelligence: cloneJson(changeIntelligence),
    graphState: cloneJson(graphState)
  };
  state.checkpoints = state.checkpoints.filter((entry) => Number(entry.sequence) !== checkpoint.sequence);
  state.checkpoints.push(checkpoint);
  state.checkpoints.sort((a, b) => Number(a.sequence) - Number(b.sequence));
  if (state.checkpoints.length > CHECKPOINT_LIMIT) {
    state.checkpoints.splice(0, state.checkpoints.length - CHECKPOINT_LIMIT);
  }
  state.updatedAt = timestamp;
  saveDevelopmentReplay(workspaceRoot, state);
  return Object.freeze(checkpoint);
}

function publicSession(session, events) {
  const sessionEvents = events.filter((event) => event.sessionId === session.id);
  const milestones = sessionEvents.filter((event) => MILESTONE_TYPES.has(event.type));
  return Object.freeze({
    ...cloneJson(session),
    milestones: Object.freeze(milestones.map((event) => Object.freeze({
      sequence: event.sequence,
      timestamp: event.timestamp,
      type: event.type,
      moduleId: event.moduleId ?? null,
      summary: event.summary ?? null
    })))
  });
}

export function replayTimelinePayload(workspaceRoot) {
  const state = loadDevelopmentReplay(workspaceRoot);
  const events = state.events;
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    updatedAt: state.updatedAt,
    earliestSequence: events[0]?.sequence ?? state.latestSequence,
    latestSequence: state.latestSequence,
    eventCount: events.length,
    sessions: Object.freeze(state.sessions.map((session) => publicSession(session, events))),
    milestones: Object.freeze(events
      .filter((event) => MILESTONE_TYPES.has(event.type))
      .map((event) => Object.freeze({
        sequence: event.sequence,
        timestamp: event.timestamp,
        type: event.type,
        taskId: event.taskId ?? null,
        sessionId: event.sessionId ?? null,
        moduleId: event.moduleId ?? null,
        summary: event.summary ?? null
      })))
  });
}

export function replayActivityTail(workspaceRoot, { limit = 500 } = {}) {
  const state = loadDevelopmentReplay(workspaceRoot);
  const count = Math.max(1, Math.min(1000, Math.floor(limit)));
  return Object.freeze({
    latestSequence: state.latestSequence,
    events: Object.freeze(state.events.slice(-count).map((event) => Object.freeze(cloneJson(event))))
  });
}

export function replayVerificationStateAt(workspaceRoot, sequence) {
  const state = loadDevelopmentReplay(workspaceRoot);
  const maxSequence = Number.isFinite(Number(sequence))
    ? Math.max(0, Math.floor(Number(sequence)))
    : state.latestSequence;
  const latestByKey = new Map();
  for (const event of state.events) {
    if (Number(event.sequence ?? 0) > maxSequence) break;
    const status = TEST_STATUS[event.type];
    const target = String(event.test ?? "").trim();
    if (!status || !target) continue;
    const key = `${event.moduleId ?? ""}\0${target}`;
    latestByKey.set(key, {
      key,
      target,
      moduleId: event.moduleId ?? null,
      status,
      sequence: event.sequence,
      timestamp: event.timestamp,
      summary: event.summary ?? null
    });
  }
  const entries = [...latestByKey.values()].sort((a, b) =>
    Number(a.sequence) - Number(b.sequence) || String(a.key).localeCompare(String(b.key))
  );
  return Object.freeze({
    schemaVersion: 1,
    updatedAt: entries.at(-1)?.timestamp ?? null,
    entries: Object.freeze(entries)
  });
}

export function replayFramePayload(workspaceRoot, sequence) {
  const state = loadDevelopmentReplay(workspaceRoot);
  const requested = Number(sequence);
  const target = Number.isFinite(requested)
    ? Math.max(0, Math.min(state.latestSequence, Math.floor(requested)))
    : state.latestSequence;
  const visibleEvents = state.events.filter((event) => Number(event.sequence ?? 0) <= target);
  const activity = visibleEvents.at(-1) ?? null;
  const checkpoint = [...state.checkpoints]
    .reverse()
    .find((entry) => Number(entry.sequence ?? 0) <= target) ?? null;
  const milestones = visibleEvents.filter((event) => MILESTONE_TYPES.has(event.type));
  const session = activity?.sessionId
    ? state.sessions.find((entry) => entry.id === activity.sessionId) ?? null
    : null;

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sequence: target,
    latestSequence: state.latestSequence,
    live: target >= state.latestSequence,
    activity: activity ? Object.freeze(cloneJson(activity)) : null,
    session: session ? publicSession(session, visibleEvents) : null,
    changeIntelligence: checkpoint?.changeIntelligence ? Object.freeze(cloneJson(checkpoint.changeIntelligence)) : null,
    graphState: checkpoint?.graphState ? Object.freeze(cloneJson(checkpoint.graphState)) : null,
    milestones: Object.freeze(milestones.map((event) => Object.freeze({
      sequence: event.sequence,
      timestamp: event.timestamp,
      type: event.type,
      taskId: event.taskId ?? null,
      sessionId: event.sessionId ?? null,
      moduleId: event.moduleId ?? null,
      summary: event.summary ?? null
    })))
  });
}
