// Discord supports only a subset of Markdown: pipe tables need a text fallback.
function fenceAt(line) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  return { marker: match[1], info: match[2] };
}

function closes(fence, active) {
  return fence && fence.marker[0] === active.marker[0]
    && fence.marker.length >= active.marker.length && !fence.info.trim();
}

function cells(line) {
  const result = [];
  let cell = '', ticks = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '\\' && i + 1 < line.length) { cell += char + line[++i]; continue; }
    if (char === '`') {
      let end = i + 1;
      while (line[end] === '`') end++;
      const count = end - i;
      if (!ticks) ticks = count;
      else if (ticks === count) ticks = 0;
      cell += line.slice(i, end); i = end - 1; continue;
    }
    if (char === '|' && !ticks) { result.push(cell.trim()); cell = ''; }
    else cell += char;
  }
  result.push(cell.trim());
  if (line.trimStart().startsWith('|')) result.shift();
  if (result.at(-1) === '' && line.trimEnd().endsWith('|')) result.pop();
  return result;
}

export function formatDiscordMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let active = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], fence = fenceAt(line);
    if (active) {
      output.push(line);
      if (closes(fence, active)) active = null;
      continue;
    }
    if (fence) { active = fence; output.push(line); continue; }
    const headers = cells(line), separator = cells(lines[i + 1] ?? '');
    if (headers.length < 2 || separator.length !== headers.length
        || !separator.every(value => /^:?-{3,}:?$/.test(value))) {
      output.push(line); continue;
    }
    // Preserve every cell and supported inline Markdown. Do not escape the whole reply.
    const rows = [];
    let next = i + 2;
    while (next < lines.length && lines[next].trim() && !fenceAt(lines[next])) {
      const row = cells(lines[next]);
      if (row.length !== headers.length) break;
      rows.push(row); next++;
    }
    if (!rows.length) { output.push(line); continue; }
    output.push('');
    for (const row of rows) {
      output.push(`- ${headers[0]}：${row[0]}`);
      for (let column = 1; column < headers.length; column++)
        output.push(`  - ${headers[column]}：${row[column]}`);
      output.push('');
    }
    i = next - 1;
  }
  return output.join('\n');
}

/** Close/reopen fenced blocks across messages; retain indentation and UTF-16 pairs. */
export function splitDiscordMessage(text, limit = 1850) {
  if (!Number.isInteger(limit) || limit < 64 || limit > 2000) throw new RangeError('Invalid Discord message limit');
  const normalized = formatDiscordMarkdown(text).trim() || 'Codex completed without a final message.';
  const chunks = [];
  let chunk = '', active = null;
  const suffix = () => active ? `\n${active.marker}` : '';
  const flush = () => {
    if (chunk.trim()) chunks.push((chunk + suffix()).trimEnd());
    chunk = active ? `${active.marker}${active.info}\n` : '';
  };
  for (const line of normalized.split('\n')) {
    const fence = fenceAt(line);
    if (active && closes(fence, active)) {
      chunk += `${active.marker}\n`; active = null;
      continue;
    }
    // Bound unusual fence metadata so reopening always leaves room for content.
    if (!active && fence && line.length < limit / 4) {
      if (chunk.length + line.length + 1 + fence.marker.length + 1 > limit) flush();
      active = fence; chunk += `${line}\n`; continue;
    }
    let remaining = `${line}\n`;
    if (chunk && remaining.length <= limit - suffix().length
        && chunk.length + remaining.length + suffix().length > limit) flush();
    while (remaining.length) {
      let room = limit - chunk.length - suffix().length;
      if (room < 2) { flush(); continue; }
      let cut = Math.min(room, remaining.length);
      if (cut < remaining.length && /[\uD800-\uDBFF]/.test(remaining[cut - 1])
          && /[\uDC00-\uDFFF]/.test(remaining[cut])) cut--;
      chunk += remaining.slice(0, cut); remaining = remaining.slice(cut);
      if (remaining.length) flush();
    }
  }
  flush();
  return chunks;
}
