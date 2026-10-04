import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadKnowledge } from '../../../intelligence/workspace-knowledge.mjs';
import { startModelProxy } from './proxy.mjs';

const HELP = `Native Codex CLI with automatic per-turn model selection

node scripts/codex-auto.mjs [--cwd PATH] [--model MODEL] [--effort EFFORT] [-- NATIVE_ARGS...]

Examples:
  node scripts/codex-auto.mjs --cwd ..
  node scripts/codex-auto.mjs -- resume THREAD_ID
  node scripts/codex-auto.mjs -- --sandbox read-only

Install once: npm ci --prefix tools/codex-auto
Requires Codex CLI with --remote Unix-socket support (tested with 0.153.4).
Auto mode overrides the native /model picker at the next user turn. Use --model
to request a fixed model; the task's strong-reasoning floor still applies.
Prompts/transcripts are not stored by the router. Native Codex owns its history,
approvals and sandbox. No existing service or session is restarted.
`;

export function parseLauncherArgs(argv, cwd = process.cwd()) {
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const nativeArgs = separator === -1 ? [] : argv.slice(separator + 1);
  const { values } = parseArgs({ args: own, options: { cwd: { type: 'string' }, model: { type: 'string' },
    effort: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  // The launcher owns the transport and route preference. Never silently bypass its endpoint.
  if (nativeArgs.some(arg => /^(?:--remote(?:-auth-token-env)?|--model|--cd)(?:=|$)|^-[mC]/.test(arg))) {
    throw new Error('Use launcher --cwd/--model; native --remote is owned by the router');
  }
  if (values.model && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(values.model)) throw new Error('Invalid model preference');
  if (values.effort && !['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(values.effort)) throw new Error('Invalid reasoning effort');
  // Config flags must reach the backend as well as the remote TUI. Other native CLI flags remain native.
  const serverArgs = [];
  for (let i = 0; i < nativeArgs.length; i++) {
    const arg = nativeArgs[i];
    if (['-c', '--config', '--enable', '--disable'].includes(arg)) {
      if (!nativeArgs[i + 1]) throw new Error('Missing native config value');
      serverArgs.push(arg, nativeArgs[++i]);
    } else if (/^--(?:config|enable|disable)=/.test(arg) || /^-c./.test(arg) || arg === '--strict-config') serverArgs.push(arg);
    else if (arg === '--profile' || arg === '-p' || arg.startsWith('--profile=')) throw new Error('Profiles are not supported by this launcher; use native --config overrides');
  }
  return { help: values.help, cwd: path.resolve(cwd, values.cwd ?? '.'), model: values.model ?? null,
    effort: values.effort ?? null, nativeArgs, serverArgs };
}

export async function runAutoCli({ argv = process.argv.slice(2), cwd = process.cwd(), env = process.env,
  stdout = process.stdout, stderr = process.stderr, signals = process, spawnImpl = spawn,
  proxyFactory = startModelProxy, knowledge = null } = {}) {
  const options = parseLauncherArgs(argv, cwd);
  if (options.help) { stdout.write(HELP); return 0; }
  const codexBin = env.TOTEM_CODEX_BIN || 'codex';
  const proxy = await proxyFactory({ ...options, env, codexBin, knowledge: knowledge ?? loadKnowledge(),
    onDecision: decision => stderr.write(`[Totem model] selected ${decision.model} / ${decision.effort ?? 'default'} for next turn\n`) });
  let child = null, interrupted = 0;
  const terminate = () => { interrupted = 143; child?.kill('SIGTERM'); void proxy.close(); };
  // SIGINT belongs to the native TUI: it cancels its turn without destroying the router.
  const interrupt = () => {};
  signals.on('SIGTERM', terminate); signals.on('SIGINT', interrupt);
  try {
    child = spawnImpl(codexBin, ['--remote', proxy.endpoint, '-C', options.cwd, ...options.nativeArgs],
      { cwd: options.cwd, env, stdio: 'inherit' });
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(interrupted || (signal === 'SIGINT' ? 130 : code ?? 1)));
    });
  } finally {
    signals.removeListener('SIGTERM', terminate); signals.removeListener('SIGINT', interrupt);
    await proxy.close();
  }
}
