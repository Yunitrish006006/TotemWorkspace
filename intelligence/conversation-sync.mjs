const SCHEMA_VERSION = 1;
const DEFAULT_ENTRY_LIMIT = 160;
const ENTRY_KINDS = new Set(["prompt", "progress", "status"]);

function boundedText(value, maxLength) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function normalizedAfter(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

/**
 * Ephemeral, loopback-only transcript for the two developer-tool surfaces.
 * Prompts deliberately never enter the durable development replay: the user
 * chose to mirror them between the local viewer and their allow-listed Discord
 * channel, not to publish them with workspace telemetry.
 */
export function createConversationSync({ now = () => new Date().toISOString(), entryLimit = DEFAULT_ENTRY_LIMIT } = {}) {
  if (!Number.isSafeInteger(entryLimit) || entryLimit < 1) throw new Error("entryLimit must be a positive integer");

  let revision = 0;
  let draft = null;
  const entries = [];
  const submissions = new Map();
  const taskConversations = new Map();

  function nextRevision() {
    revision += 1;
    return revision;
  }

  function publicEntry(entry) {
    return Object.freeze({
      ...entry,
      conversationId: entry.conversationId ?? (entry.taskId ? taskConversations.get(entry.taskId) ?? null : null)
    });
  }

  function append({ source, kind, text, taskId = null, status = null, clientMessageId = null, conversationId = null } = {}) {
    const normalizedSource = boundedText(source, 32);
    const normalizedKind = boundedText(kind, 24);
    const normalizedText = boundedText(text, 8 * 1024);
    const normalizedClientMessageId = boundedText(clientMessageId, 160);
    if (!normalizedSource) throw new Error("conversation entry source is required");
    if (!normalizedKind || !ENTRY_KINDS.has(normalizedKind)) throw new Error("unsupported conversation entry kind");
    if (!normalizedText) throw new Error("conversation entry text is required");
    if (normalizedClientMessageId && submissions.has(normalizedClientMessageId)) {
      return Object.freeze({ entry: submissions.get(normalizedClientMessageId), duplicate: true });
    }
    const entry = Object.freeze({
      revision: nextRevision(),
      timestamp: now(),
      source: normalizedSource,
      kind: normalizedKind,
      text: normalizedText,
      taskId: boundedText(taskId, 160),
      status: boundedText(status, 80),
      clientMessageId: normalizedClientMessageId,
      conversationId: boundedText(conversationId, 160) ?? normalizedClientMessageId
    });
    entries.push(entry);
    if (entries.length > entryLimit) entries.splice(0, entries.length - entryLimit);
    if (normalizedClientMessageId) submissions.set(normalizedClientMessageId, entry);
    return Object.freeze({ entry: publicEntry(entry), duplicate: false });
  }

  function submission(clientMessageId) {
    const key = boundedText(clientMessageId, 160);
    const entry = key ? submissions.get(key) : null;
    return entry ? publicEntry(entry) : null;
  }

  function linkTask(taskId, conversationId) {
    const task = boundedText(taskId, 160);
    const conversation = boundedText(conversationId, 160);
    if (!task || !conversation) return;
    taskConversations.set(task, conversation);
  }

  function setDraft({ clientId, text } = {}) {
    const normalizedClientId = boundedText(clientId, 160);
    if (!normalizedClientId) throw new Error("draft clientId is required");
    const normalizedText = boundedText(text, 8 * 1024);
    draft = normalizedText
      ? Object.freeze({ revision: nextRevision(), timestamp: now(), clientId: normalizedClientId, text: normalizedText })
      : null;
    if (!normalizedText) nextRevision();
    return draft;
  }

  function clearDraft(clientId = null) {
    const normalizedClientId = boundedText(clientId, 160);
    if (normalizedClientId && draft?.clientId !== normalizedClientId) return draft;
    if (draft) nextRevision();
    draft = null;
    return null;
  }

  function snapshot({ after = 0 } = {}) {
    const cursor = normalizedAfter(after);
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      generatedAt: now(),
      latestRevision: revision,
      draft,
      entries: entries.filter((entry) => entry.revision > cursor).map(publicEntry)
    });
  }

  return Object.freeze({ append, clearDraft, linkTask, setDraft, snapshot, submission });
}
