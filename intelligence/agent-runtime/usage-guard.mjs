const toolTypes = new Set(['commandExecution', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'collabAgentToolCall', 'imageGeneration', 'fileChange']);

export function createUsageGuard({ maxToolCalls = 80, maxContextTokens = 64000 } = {}) {
  const seen = new Set();
  let usage = null;
  let firstContext = null;
  let peakContext = 0;
  let warningSent = false;
  let stopped = false;
  const snapshot = () => {
    const input = usage?.total?.inputTokens ?? null;
    const output = usage?.total?.outputTokens ?? null;
    return { observedToolCalls: seen.size, modelTurns: null, firstContext, peakContext,
      threadInputTokens: input, threadCachedInputTokens: usage?.total?.cachedInputTokens ?? null,
      threadOutputTokens: output, inputOutputRatio: Number.isFinite(input) && output > 0 ? input / output : null,
      stopped, scope: 'observed-tools-and-reported-thread-totals' };
  };
  return {
    snapshot,
    observe(event) {
      if (event.method === 'item/started' && toolTypes.has(event.params?.item?.type) && event.params.item.id) seen.add(event.params.item.id);
      if (event.method === 'thread/tokenUsage/updated' && event.params?.tokenUsage) {
        usage = event.params.tokenUsage;
        const context = usage.last?.inputTokens;
        if (Number.isFinite(context) && context >= 0) {
          firstContext ??= context;
          peakContext = Math.max(peakContext, context);
        }
      }
      const state = snapshot();
      if (!stopped && (seen.size >= maxToolCalls || peakContext >= maxContextTokens)) {
        stopped = true;
        return { action: 'stop', ...snapshot() };
      }
      if (!stopped && !warningSent && (seen.size >= maxToolCalls / 2 || peakContext >= maxContextTokens * .75
          || state.threadInputTokens >= 20000 && state.inputOutputRatio > 100)) {
        warningSent = true;
        return { action: 'checkpoint', ...state };
      }
      return null;
    }
  };
}
