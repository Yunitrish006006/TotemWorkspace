#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const VIEWER = path.join(ROOT, "viewer_flutter");

const INCLUDE = [
  "lib",
  "web",
  "assets",
  "pubspec.yaml",
  "pubspec.lock",
  "analysis_options.yaml"
];

function walk(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  for (const entry of fs.readdirSync(target).sort()) {
    const full = path.join(target, entry);
    const child = fs.statSync(full);
    if (child.isDirectory()) out.push(...walk(full));
    else if (child.isFile()) out.push(full);
  }
  return out;
}

const files = INCLUDE.flatMap((entry) => walk(path.join(VIEWER, entry)))
  .filter((file) => !file.includes(`${path.sep}build${path.sep}`))
  .sort();

const hash = crypto.createHash("sha256");
for (const file of files) {
  const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
  hash.update(relative);
  hash.update("\0");
  hash.update(fs.readFileSync(file));
  hash.update("\0");
}

process.stdout.write(`${hash.digest("hex")}\n`);
