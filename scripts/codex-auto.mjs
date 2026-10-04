#!/usr/bin/env node
try {
  const { runAutoCli } = await import('../tools/codex-auto/src/cli.mjs');
  process.exitCode = await runAutoCli();
} catch (error) {
  process.stderr.write(error.code === 'ERR_MODULE_NOT_FOUND'
    ? 'Install router dependencies: npm ci --prefix tools/codex-auto\n'
    : `${error.message}\n`);
  process.exitCode = 1;
}
