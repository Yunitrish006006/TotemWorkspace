#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { CodexRunner } from '../intelligence/agent-runtime/runtime.mjs';
import { probeCodexRuntime } from '../intelligence/codex-runtime-probe.mjs';

const HELP = `TotemWorkspace shared Agent runtime

node scripts/totem-runtime.mjs capabilities [--cwd PATH]
node scripts/totem-runtime.mjs run [--cwd PATH] [--thread ID] [--read-only] [--json] TASK...
node scripts/totem-runtime.mjs resume --thread ID [--cwd PATH] TASK...

When TASK is omitted, read it from stdin. Optional --model and --effort express
an explicit user preference; otherwise the shared live catalog router decides.
SIGINT cancels the active turn. Unsupported approvals are declined.
Capabilities are read-only and never start a model turn.
`;

export async function runRuntimeCli({ argv = process.argv.slice(2), stdin = process.stdin,
  stdout = process.stdout, stderr = process.stderr, cwd = process.cwd(), env = process.env,
  signals = process, Runner = CodexRunner, probe = probeCodexRuntime } = {}) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    cwd: { type: 'string' }, thread: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' },
    'read-only': { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
  } });
  const [command = 'help', ...task] = positionals;
  if (values.help || command === 'help') { stdout.write(HELP); return 0; }
  const workspace = path.resolve(cwd, values.cwd ?? env.TOTEM_CODEX_CWD ?? '.');
  const codexBin = env.TOTEM_CODEX_BIN || 'codex';
  if (command === 'capabilities') {
    const report = await probe({ codexBin, cwd: workspace, env });
    const capabilities = report.capabilities ?? {};
    stdout.write(`${JSON.stringify({ capabilities, models: (report.models ?? []).map(model => model.model ?? model.id),
      checkedAt: report.checkedAt }, null, 2)}\n`);
    return capabilities.cliAvailable && capabilities.appServerAvailable && capabilities.modelCatalogAvailable
      && capabilities.intelligenceAvailable ? 0 : 1;
  }
  if (!['run', 'resume'].includes(command)) throw new Error(`Unknown runtime command: ${command}`);
  if (command === 'resume' && !values.thread) throw new Error('resume requires --thread ID');
  let prompt = task.join(' ').trim();
  if (!prompt) {
    if (stdin.isTTY) throw new Error('Provide a task argument or pipe a task through stdin');
    stdin.setEncoding?.('utf8');
    for await (const chunk of stdin) {
      prompt += chunk.toString();
      if (prompt.length > 120000) throw new Error('Task must be at most 120000 characters');
    }
    prompt = prompt.trim();
  }
  if (!prompt) throw new Error('Task cannot be empty');
  const runner = new Runner({ codexBin, env });
  const key = `cli:${workspace}`;
  let interrupted = 0;
  const interrupt = () => { interrupted = 130; runner.cancel(key); };
  const terminate = () => { interrupted = 143; runner.cancel(key); };
  signals.on('SIGINT', interrupt);
  signals.on('SIGTERM', terminate);
  try {
    const result = await runner.execute({ key, workspace, prompt,
      model: values.model ?? env.TOTEM_CODEX_MODEL ?? null,
      reasoningEffort: values.effort ?? null, resumeSessionId: values.thread ?? null,
      readOnly: values['read-only'] === true || env.TOTEM_CODEX_SANDBOX === 'read-only',
      autoApproveGradle: false,
      onSessionId: id => stderr.write(`Session: ${id}\n`),
      onApproval: approval => {
        runner.approve(key, approval.requestId, 'decline');
        stderr.write('Approval declined: this CLI transport does not provide interactive approvals.\n');
      }
    });
    stdout.write(values.json ? `${JSON.stringify(result)}\n` : `${result.message ?? ''}\n`);
    return interrupted || (result.exitCode === 0 ? 0 : 1);
  } catch (error) {
    if (interrupted) return interrupted;
    throw error;
  } finally {
    signals.removeListener('SIGINT', interrupt);
    signals.removeListener('SIGTERM', terminate);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runRuntimeCli().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
