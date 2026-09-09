import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { runRuntimeCli } from '../../../scripts/totem-runtime.mjs';

function fixture(argv, extra = {}) {
  const output = { stdout: '', stderr: '' };
  return { output, options: { argv, cwd: '/srv/TotemCore', env: {}, signals: new EventEmitter(),
    stdout: { write: text => { output.stdout += text; } }, stderr: { write: text => { output.stderr += text; } },
    stdin: Readable.from([]), ...extra } };
}

test('CLI capabilities uses read-only shared discovery without creating a runner', async () => {
  const { output, options } = fixture(['capabilities'], {
    Runner: class { constructor() { throw new Error('must not start a turn'); } },
    probe: async ({ cwd }) => {
      assert.equal(cwd, '/srv/TotemCore');
      return { capabilities: { cliAvailable: true, appServerAvailable: true, modelCatalogAvailable: true,
        intelligenceAvailable: true, astraAvailable: false, lightweightAvailable: true }, models: [{ id: 'live-mini' }], checkedAt: 123 };
    }
  });
  assert.equal(await runRuntimeCli(options), 0);
  assert.deepEqual(JSON.parse(output.stdout).models, ['live-mini']);
  assert.equal(await runRuntimeCli({ ...options, probe: async () => ({ capabilities: { cliAvailable: true } }) }), 1);
});

test('CLI run preserves sibling cwd, delegates routing, and safely declines approvals', async () => {
  let execution;
  let decision;
  const { output, options } = fixture(['run', 'Fix', 'the', 'consumer'], { Runner: class {
    constructor(config) { assert.equal(config.codexBin, 'codex'); }
    approve(...args) { decision = args; }
    async execute(args) {
      execution = args;
      args.onSessionId('thread-1');
      args.onApproval({ requestId: 'approval-1' });
      return { exitCode: 0, message: 'Completed', sessionId: 'thread-1' };
    }
  } });
  assert.equal(await runRuntimeCli(options), 0);
  assert.equal(execution.workspace, '/srv/TotemCore');
  assert.equal(execution.prompt, 'Fix the consumer');
  assert.equal(execution.model, null);
  assert.equal(execution.autoApproveGradle, false);
  assert.deepEqual(decision, ['cli:/srv/TotemCore', 'approval-1', 'decline']);
  assert.match(output.stderr, /Session: thread-1/);
  assert.match(output.stderr, /Approval declined/);
  assert.equal(output.stdout, 'Completed\n');
});

test('CLI resume accepts stdin, JSON output and explicit read-only scope', async () => {
  let execution;
  const { output, options } = fixture(['resume', '--thread', 'existing', '--read-only', '--json'], {
    stdin: Readable.from(['Continue ', 'validation']), Runner: class {
      async execute(args) { execution = args; return { exitCode: 0, message: 'Verified' }; }
    }
  });
  assert.equal(await runRuntimeCli(options), 0);
  assert.equal(execution.prompt, 'Continue validation');
  assert.equal(execution.resumeSessionId, 'existing');
  assert.equal(execution.readOnly, true);
  assert.equal(JSON.parse(output.stdout).message, 'Verified');
});

test('CLI SIGINT cancels the active shared runtime and removes signal handlers', async () => {
  const signals = new EventEmitter();
  let cancelled;
  const { options } = fixture(['run', 'Implement'], { signals, Runner: class {
    cancel(key) { cancelled = key; }
    async execute() { signals.emit('SIGINT'); return { exitCode: 1, message: 'Stopped' }; }
  } });
  assert.equal(await runRuntimeCli(options), 130);
  assert.equal(cancelled, 'cli:/srv/TotemCore');
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('CLI rejects missing resume IDs, empty input and unknown options before execution', async () => {
  await assert.rejects(runRuntimeCli(fixture(['resume', 'Task']).options), /requires --thread/);
  await assert.rejects(runRuntimeCli(fixture(['run']).options), /cannot be empty/);
  await assert.rejects(runRuntimeCli(fixture(['run', '--unsafe']).options), /Unknown option/);
});
