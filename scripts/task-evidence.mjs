#!/usr/bin/env node
import fs from "node:fs";
import { saveTaskEvidence, readTaskEvidence } from "../intelligence/task-evidence.mjs";
const [command, id, notes, ...files] = process.argv.slice(2);
try {
  let result;
  if (command === "save") result = saveTaskEvidence(process.cwd(), id, JSON.parse(fs.readFileSync(notes, "utf8")), files);
  else if (command === "read") result = readTaskEvidence(process.cwd(), id);
  else throw new Error("Usage: task-evidence.mjs save <task-id> <notes.json> <source/config files...> | read <task-id>");
  console.log(JSON.stringify(result));
  if (result.status === "stale") process.exitCode = 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }
