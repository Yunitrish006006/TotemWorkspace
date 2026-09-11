import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

function taskPath(root, id) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new Error("Task id must be 1–64 lowercase letters, digits, _ or -");
  return path.join(root, ".totem-index", "task-evidence", `${id}.json`);
}
function head(root) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function fingerprint(root, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")
      || relative.startsWith(".git/") || relative.startsWith(".totem-index/")) throw new Error("Evidence input must be a repository-relative source path");
  const target = path.resolve(root, relative);
  if (!fs.existsSync(target)) return { path: relative, sha256: null };
  const realRoot = fs.realpathSync(root), real = fs.realpathSync(target);
  if (!real.startsWith(realRoot + path.sep) || !fs.statSync(real).isFile()) throw new Error("Evidence input escapes repository or is not a file");
  return { path: relative, sha256: crypto.createHash("sha256").update(fs.readFileSync(real)).digest("hex") };
}
export function saveTaskEvidence(root, id, notes, files) {
  const target = taskPath(root, id);
  const relativeTarget = path.relative(root, target);
  try {
    execFileSync("git", ["check-ignore", "-q", "--", relativeTarget], { cwd: root, stdio: "pipe" });
  } catch {
    throw new Error("Task evidence storage must be Git-ignored; add .totem-index/ to the repository's local .git/info/exclude first");
  }
  if (!Array.isArray(files) || !files.length || files.length > 128) throw new Error("Specify 1–128 relevant source/configuration files");
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) throw new Error("Notes must be an object");
  const allowed = ["findings", "decisions", "validation", "pending"];
  if (Object.keys(notes).some(key => !allowed.includes(key))) throw new Error("Use findings, decisions, validation and pending only");
  const normalized = Object.fromEntries(allowed.map(key => {
    const values = notes[key] ?? [];
    if (!Array.isArray(values) || values.length > 20 || values.some(value => typeof value !== "string" || value.length > 1000)) throw new Error("Each notes field accepts at most 20 short strings");
    return [key, values];
  }));
  if (JSON.stringify(normalized).length > 12000) throw new Error("Keep evidence notes within 12000 characters; reference logs instead of copying them");
  const record = { schemaVersion: 1, task: id, sourceCommit: head(root),
    inputs: [...new Set(files)].sort().map(file => fingerprint(root, file)), notes: normalized };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.realpathSync(path.dirname(target)).startsWith(fs.realpathSync(root) + path.sep)
      || (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())) throw new Error("Evidence storage must remain inside repository");
  // Local ignored notes are claims, not authenticated test results or permission grants.
  fs.writeFileSync(target, JSON.stringify(record), { mode: 0o600 });
  return { task: id, sourceCommit: record.sourceCommit, inputCount: record.inputs.length, saved: true };
}
export function readTaskEvidence(root, id) {
  const target = taskPath(root, id);
  if (!fs.realpathSync(target).startsWith(fs.realpathSync(root) + path.sep)) throw new Error("Evidence storage escapes repository");
  const record = JSON.parse(fs.readFileSync(target, "utf8"));
  if (record.schemaVersion !== 1 || record.task !== id || !Array.isArray(record.inputs)) throw new Error("Invalid task evidence record");
  const changed = record.inputs.filter(input => fingerprint(root, input.path).sha256 !== input.sha256).map(input => input.path);
  const commitChanged = head(root) !== record.sourceCommit;
  return { task: id, status: changed.length || commitChanged ? "stale" : "current", sourceCommit: record.sourceCommit,
    commitChanged, changedInputs: changed, notes: record.notes,
    authority: "Recorded notes only. Reuse within listed inputs and scope; verify cited CI provenance and never infer authorization." };
}
