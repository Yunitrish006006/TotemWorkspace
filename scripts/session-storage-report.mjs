import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(os.homedir(), '.codex', 'sessions');
const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
const report = { files: 0, bytes: 0, olderThan90Days: { files: 0, bytes: 0 }, action: 'report-only-no-deletion' };
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(filename);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const stat = fs.statSync(filename);
      report.files += 1;
      report.bytes += stat.size;
      if (stat.mtimeMs < cutoff) {
        report.olderThan90Days.files += 1;
        report.olderThan90Days.bytes += stat.size;
      }
    }
  }
}
if (fs.existsSync(root)) visit(root);
console.log(JSON.stringify(report));
