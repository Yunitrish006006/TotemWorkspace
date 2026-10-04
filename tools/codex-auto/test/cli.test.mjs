import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { parseLauncherArgs, runAutoCli } from '../src/cli.mjs';

test('launcher preserves native resume/config flags and owns endpoint/model preferences', () => {
  const args = parseLauncherArgs(['--cwd', '/tmp', '--model', 'gpt-6-sol', '--', 'resume', 'thread-123',
    '-c', 'sandbox_mode="read-only"', '--strict-config'], '/');
  assert.equal(args.cwd, '/tmp'); assert.equal(args.model, 'gpt-6-sol');
  assert.deepEqual(args.serverArgs, ['-c', 'sandbox_mode="read-only"', '--strict-config']);
  assert.deepEqual(args.nativeArgs.slice(0, 2), ['resume', 'thread-123']);
  for (const arg of ['--remote', '--remote=ws://host', '--model=x', '-mx', '-C/tmp', '--profile=x']) {
    assert.throws(() => parseLauncherArgs(['--', arg]));
  }
  assert.throws(() => parseLauncherArgs(['--effort', 'bogus']));
});

test('native TUI inherits terminal; dedicated proxy closes when TUI exits', async () => {
  let invocation, stopped = false;
  const signals = new EventEmitter();
  const code = await runAutoCli({ argv: ['--cwd', '/tmp', '--', 'resume', 'thread-123'], knowledge: {}, signals,
    proxyFactory: async () => ({ endpoint: 'unix:///tmp/test.sock', close: async () => { stopped = true; } }),
    spawnImpl: (bin, args, options) => {
      invocation = { bin, args, options }; const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0)); return child;
    } });
  assert.equal(code, 0); assert.equal(stopped, true);
  assert.equal(invocation.options.stdio, 'inherit');
  assert.deepEqual(invocation.args, ['--remote', 'unix:///tmp/test.sock', '-C', '/tmp', 'resume', 'thread-123']);
  assert.equal(signals.listenerCount('SIGINT'), 0);
});

test('launcher spawn failure cleans up the proxy', async () => {
  let stopped = false;
  await assert.rejects(runAutoCli({ argv: [], knowledge: {}, signals: new EventEmitter(),
    proxyFactory: async () => ({ endpoint: 'unix:///tmp/test.sock', close: async () => { stopped = true; } }),
    spawnImpl: () => { const child = new EventEmitter(); queueMicrotask(() => child.emit('error', new Error('missing codex'))); return child; }
  }), /missing codex/);
  assert.equal(stopped, true);
});
