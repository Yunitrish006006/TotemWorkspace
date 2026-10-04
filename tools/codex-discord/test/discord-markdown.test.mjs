import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDiscordMarkdown, splitDiscordMessage } from '../src/discord-markdown.mjs';

test('profile and FPS tables become mobile-readable rows without losing features', () => {
  const input = '**Profiles**\n\n| Profile | Feature | FPS |\n| --- | :--- | ---: |\n| RGB | **彩光** | 316 |\n| Raster | `AO` | 未測 |\n\nDone';
  const formatted = formatDiscordMarkdown(input);
  assert.match(formatted, /- Profile：RGB\n  - Feature：\*\*彩光\*\*\n  - FPS：316/);
  assert.match(formatted, /- Profile：Raster\n  - Feature：`AO`\n  - FPS：未測/);
  assert.ok(formatted.startsWith('**Profiles**'));
  assert.ok(formatted.endsWith('Done'));
  assert.ok(!formatted.includes('| ---'));
});

test('optional outer pipes, escaped pipes and inline-code pipes retain cells', () => {
  const result = formatDiscordMarkdown('Name | Value\n--- | ---\nA | `x|y`\nB | x\\|y');
  assert.match(result, /Value：`x\|y`/);
  assert.match(result, /Value：x\\\|y/);
});

test('supported Markdown and non-table pipes are unchanged', () => {
  const source = '# Title\n**bold** *italic* ~~strike~~\n- list\n> quote\n[site](https://example.org)\na | b\nnot a delimiter';
  assert.equal(formatDiscordMarkdown(source), source);
  assert.equal(splitDiscordMessage(source).length, 1);
});

test('table-like code inside fences is not converted', () => {
  for (const fence of ['```', '~~~~']) {
    const source = `${fence}text\n| A | B |\n| --- | --- |\n| x | y |\n${fence}`;
    assert.equal(formatDiscordMarkdown(source), source);
  }
});

test('empty and malformed tables are left intact', () => {
  for (const text of ['a|b\n---|---', 'a|b\n---|---|---\nx|y', 'a|b\n--|---\nx|y'])
    assert.equal(formatDiscordMarkdown(text), text);
});

test('long fenced code is closed and reopened with language and indentation', () => {
  const code = Array.from({ length: 60 }, (_, i) => `    line_${i}();`);
  const chunks = splitDiscordMessage('```js\n' + code.join('\n') + '\n```', 128);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 128);
    assert.ok(chunk.startsWith('```js\n'));
    assert.ok(chunk.endsWith('\n```'));
    assert.equal(chunk.split('```').length, 3);
  }
  assert.deepEqual(chunks.flatMap(chunk => chunk.slice(6, -4).trimEnd().split('\n')), code);
});

test('unterminated code fence is closed and prose after a closed fence stays outside', () => {
  assert.equal(splitDiscordMessage('```txt\nhello')[0], '```txt\nhello\n\n```');
  const text = 'intro\n```js\n' + '  x();\n'.repeat(50) + '```\n**finished**';
  const chunks = splitDiscordMessage(text, 128);
  for (const chunk of chunks) assert.equal((chunk.match(/```/g) ?? []).length % 2, 0);
  assert.ok(chunks.at(-1).endsWith('**finished**'));
});

test('long Unicode text never exceeds limits or breaks surrogate pairs', () => {
  const source = '光😀'.repeat(3000);
  const chunks = splitDiscordMessage(source);
  assert.equal(chunks.join(''), source);
  for (const chunk of chunks) { assert.ok(chunk.length <= 1850); assert.ok(chunk.isWellFormed()); }
});

test('bounds and empty result fallback', () => {
  assert.match(splitDiscordMessage('  ')[0], /without a final message/);
  for (const limit of [0, 63, 2001, NaN]) assert.throws(() => splitDiscordMessage('x', limit), RangeError);
});
