const COMPACTION_METHODS = new Set([
  'thread/compacted',
  'thread/compaction/completed'
]);

function tokenNumber(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

/** Normalize only numeric usage counters; absent runtime evidence remains null. */
export function normalizeTokenUsage(raw = {}) {
  raw = raw?.last ?? raw?.total ?? raw ?? {};
  const usage = {
    inputTokens: tokenNumber(raw.input_tokens ?? raw.inputTokens),
    cachedInputTokens: tokenNumber(raw.cached_input_tokens ?? raw.cachedInputTokens),
    cacheWriteInputTokens: tokenNumber(raw.cache_write_input_tokens ?? raw.cacheWriteInputTokens),
    outputTokens: tokenNumber(raw.output_tokens ?? raw.outputTokens),
    reasoningOutputTokens: tokenNumber(raw.reasoning_output_tokens ?? raw.reasoningOutputTokens)
  };
  usage.totalTokens = usage.inputTokens !== null && usage.outputTokens !== null
    ? usage.inputTokens + usage.outputTokens
    : null;
  return Object.freeze(usage);
}

export function isCompactionEvent(event) {
  return COMPACTION_METHODS.has(event?.method)
    || (event?.method === 'item/completed' && event.params?.item?.type === 'contextCompaction');
}

/** Build content-free telemetry. No prompt, paths, event payloads or reason text are retained. */
export function createTurnTelemetry({ tokenUsage = null, boundedContext = null,
  boundedContextBytes = null, compactionCount = 0 } = {}) {
  const serialized = boundedContext == null ? null
    : typeof boundedContext === 'string' ? boundedContext : JSON.stringify(boundedContext);
  const bytes = Number.isSafeInteger(boundedContextBytes) && boundedContextBytes >= 0
    ? boundedContextBytes
    : serialized == null ? 0 : Buffer.byteLength(serialized, 'utf8');
  const count = Number.isSafeInteger(compactionCount) && compactionCount > 0 ? compactionCount : 0;
  return Object.freeze({
    schemaVersion: 1,
    tokens: normalizeTokenUsage(tokenUsage ?? {}),
    boundedContext: Object.freeze({
      bytes,
      estimatedTokens: Math.ceil(bytes / 4),
      tokenCountKind: 'estimated-from-utf8-bytes'
    }),
    compaction: Object.freeze({
      status: count > 0 ? 'observed' : 'unknown',
      observedCount: count > 0 ? count : null,
      evidence: count > 0 ? 'runtime-event' : null
    })
  });
}
