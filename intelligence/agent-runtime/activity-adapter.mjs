/** Translate only actual App Server notifications; plans never synthesize lifecycle. */
const ITEM_TYPES = {
  agentMessage: 'agent_message', commandExecution: 'command_execution', fileChange: 'file_change',
  mcpToolCall: 'mcp_tool_call', dynamicToolCall: 'dynamic_tool_call', webSearch: 'web_search',
  imageView: 'image_view', imageGeneration: 'image_generation', reasoning: 'reasoning',
  collabAgentToolCall: 'collab_tool_call', collabToolCall: 'collab_tool_call', subagentActivity: 'subagent_activity',
};

export function adaptAppServerActivity(event) {
  const params = event?.params ?? {};
  switch (event?.method) {
    case 'thread/started': return { type: 'thread.started', thread_id: params.thread?.id ?? params.threadId };
    case 'turn/started': return { type: 'turn.started', thread_id: params.threadId, turn_id: params.turn?.id ?? params.turnId };
    case 'turn/completed': return { type: params.turn?.status === 'completed' ? 'turn.completed' : 'turn.failed',
      thread_id: params.threadId, turn_id: params.turn?.id, error: params.turn?.error,
      ...(params.turn?.usage ? { usage: params.turn.usage } : {}) };
    case 'item/started':
    case 'item/completed': {
      const item = params.item;
      if (!item) return null;
      return { type: event.method === 'item/started' ? 'item.started' : 'item.completed',
        thread_id: params.threadId, turn_id: params.turnId,
        item: { ...item, type: ITEM_TYPES[item.type] ?? item.type,
          ...(item.exitCode !== undefined ? { exit_code: item.exitCode } : {}),
          ...(item.aggregatedOutput !== undefined ? { aggregated_output: item.aggregatedOutput } : {}),
          ...(item.receiverThreadIds ? { receiver_thread_ids: item.receiverThreadIds } : {}),
          ...(item.senderThreadId ? { sender_thread_id: item.senderThreadId } : {}) } };
    }
    case 'thread/tokenUsage/updated': return { type: 'usage.updated', thread_id: params.threadId,
      turn_id: params.turnId, usage: params.tokenUsage?.last ?? params.tokenUsage?.total,
      token_usage: params.tokenUsage };
    case 'item/agentMessage/delta': return { type: 'item.delta', item_id: params.itemId, delta: params.delta };
    case 'error': return { type: 'error', message: params.error?.message, error: params.error };
    default: return null;
  }
}

export function normalizeAppServerEvent(event) {
  const normalized = adaptAppServerActivity(event);
  const events = normalized ? [normalized] : [];
  const params = event?.params ?? {};
  if (event?.method === 'thread/started' || event?.method === 'turn/started') {
    const model = params.turn?.model ?? params.thread?.model;
    if (typeof model === 'string' && model) events.push({ type: 'model.selected', model,
      agentId: params.threadId ?? params.thread?.id, summary: 'Runtime reported selected model' });
  }
  const item = params.item;
  if (event?.method === 'item/completed' && ['collabAgentToolCall', 'collabToolCall'].includes(item?.type)) {
    if (item.tool === 'spawnAgent' && item.status === 'completed') {
      for (const agentId of item.receiverThreadIds ?? []) {
        if (typeof agentId !== 'string' || !agentId) continue;
        events.push({ type: 'agent.spawned', agentId,
          ...(typeof item.model === 'string' ? { model: item.model } : {}),
          summary: 'Runtime confirmed delegated thread creation' });
      }
    }
    for (const [agentId, state] of Object.entries(item.agentsStates ?? item.agentStates ?? {})) {
      const status = state?.status ?? state;
      if (['completed', 'closed', 'shutdown'].includes(status)
        || (status && typeof status === 'object' && Object.hasOwn(status, 'completed'))) {
        events.push({ type: 'agent.completed', agentId,
          ...(typeof state?.model === 'string' ? { model: state.model } : {}),
          summary: 'Runtime reported delegated thread completion or closure' });
      }
    }
  }
  return events;
}
