#!/usr/bin/env node

const DEFAULT_BASE = process.env.TOTEM_LOCAL_API?.replace(/\/$/, "") || "http://127.0.0.1:18765";

function usage() {
  process.stdout.write(`Totem local activity bridge helper

Usage:
  node scripts/totem-activity.mjs emit <type> [options]
  node scripts/totem-activity.mjs prompt <on|off>
  node scripts/totem-activity.mjs status

Emit options:
  --module <totem-id>
  --feature <feature-id>
  --component <component-id>
  --file <repo-relative-path>
  --symbol <symbol>
  --summary <text>
  --status <status>
  --test <test-name>
  --task <task-id>

Environment:
  TOTEM_LOCAL_API=http://127.0.0.1:18765
`);
}

function parseOptions(args) {
  const out = {};
  const aliases = {
    module: "moduleId",
    feature: "featureId",
    component: "componentId",
    file: "file",
    symbol: "symbol",
    summary: "summary",
    status: "status",
    test: "test",
    task: "taskId"
  };
  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index];
    if (!raw.startsWith("--")) throw new Error(`unexpected argument: ${raw}`);
    const inline = raw.indexOf("=");
    const key = raw.slice(2, inline >= 0 ? inline : undefined);
    const target = aliases[key];
    if (!target) throw new Error(`unknown option: --${key}`);
    const value = inline >= 0 ? raw.slice(inline + 1) : args[++index];
    if (!value) throw new Error(`missing value for --${key}`);
    out[target] = value;
  }
  return out;
}

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(`${DEFAULT_BASE}${path}`, {
    method,
    headers: body == null ? undefined : { "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help") {
    usage();
    return;
  }

  if (command === "status") {
    const [health, settings, activity] = await Promise.all([
      request("/api/health"),
      request("/api/viewer-settings"),
      request("/api/activity?after=0")
    ]);
    process.stdout.write(`${JSON.stringify({
      health,
      settings,
      latestSequence: activity.latestSequence,
      latestEvent: activity.events?.at(-1) ?? null
    }, null, 2)}\n`);
    return;
  }

  if (command === "prompt") {
    const value = rest[0];
    if (value !== "on" && value !== "off") throw new Error("prompt expects on or off");
    const settings = await request("/api/viewer-settings", {
      method: "POST",
      body: { promptEnabled: value === "on" }
    });
    process.stdout.write(`Prompt ${settings.promptEnabled ? "ON" : "OFF"}\n`);
    return;
  }

  if (command === "emit") {
    const [type, ...optionArgs] = rest;
    if (!type) throw new Error("emit requires an activity type");
    const event = await request("/api/activity", {
      method: "POST",
      body: { type, ...parseOptions(optionArgs) }
    });
    process.stdout.write(`${JSON.stringify(event.event, null, 2)}\n`);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`totem-activity: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
