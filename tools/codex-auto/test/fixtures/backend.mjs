import { createInterface } from 'node:readline';
const seen = [];
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  seen.push(message);
  if (!message.method) { send({ method: 'test/approvalReply', params: message }); return; }
  const reply = result => send({ id: message.id, result });
  if (message.method === 'initialize') reply({ userAgent: 'fixture' });
  else if (message.method === 'initialized') return;
  else if (message.method === 'thread/start' || message.method === 'thread/resume') {
    reply({ cwd: message.params.cwd, thread: { id: message.params.threadId ?? 'thread-1', turns: [] } });
  } else if (message.method === 'model/list') {
    // Delayed catalog proves interrupts and approvals are not stuck behind routing.
    setTimeout(() => reply({ data: (message.params.cursor ? ['gpt-6-sol', 'gpt-6-astra'] : ['gpt-6-luna'])
      .map(model => ({ model, supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }],
        inputModalities: ['text', 'image'] })), nextCursor: message.params.cursor ? null : 'page-2' }), 20);
  } else if (message.method === 'account/rateLimits/read') reply({ rateLimitsByLimitId: {} });
  else if (message.method === 'turn/start') {
    reply({ turn: { id: 'turn-1', status: 'inProgress' } });
    send({ method: 'turn/started', params: { threadId: message.params.threadId, turn: { id: 'turn-1' } } });
    send({ id: 'totem-router-3', method: 'item/commandExecution/requestApproval', params: { command: 'test-command' } });
    send({ method: 'test/routed', params: message.params });
  } else if (message.method === 'turn/interrupt') { reply({}); send({ method: 'test/interrupted' }); }
  else if (message.method === 'test/read') reply({ seen });
  else reply({});
});
