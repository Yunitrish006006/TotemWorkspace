import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  createWorkloadSpawner,
  validateScopeUnitName,
  validateWorkloadScopeMode
} from "../../../intelligence/agent-runtime/process-scope.mjs";

function fakeChild() {
  const child = new EventEmitter();
  child.killCalls = [];
  child.kill = (signal) => { child.killCalls.push(signal); return true; };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

test("systemd scope preserves process options and signals the complete unit", () => {
  const calls = [];
  const probes = [];
  const signals = [];
  const child = fakeChild();
  const spawnWorkload = createWorkloadSpawner({
    mode: "systemd",
    probeImpl(command, args, options) {
      probes.push({ command, args, options });
      return { status: 0, stdout: "available" };
    },
    spawnImpl(command, args, options) { calls.push({ command, args, options }); return child; },
    signalImpl(command, args, options) { signals.push({ command, args, options }); return { status: 0 }; },
    unitNameFactory: () => "totem-codex-test-1.scope"
  });
  const options = { cwd: "/srv/TotemLumen", env: { PATH: "/bin" }, stdio: ["pipe", "pipe", "pipe"] };
  const result = spawnWorkload("codex", ["app-server"], options);

  assert.equal(probes[0].command, "systemctl");
  assert.deepEqual(probes[0].args, ["--user", "show", "--property=Version", "--value"]);
  assert.equal(probes[1].command, "systemd-run");
  assert.deepEqual(probes[2].args, ["--user", "--scope", "--quiet", "--collect",
    `--unit=totem-codex-probe-${process.pid}.scope`, "--", "true"]);
  assert.deepEqual(calls, [{
    command: "systemd-run",
    args: ["--user", "--scope", "--quiet", "--collect", "--unit=totem-codex-test-1.scope", "--", "codex", "app-server"],
    options
  }]);
  assert.notEqual(result.stdin, child.stdin);
  assert.notEqual(result.stdout, child.stdout);
  assert.notEqual(result.stderr, child.stderr);
  assert.deepEqual(result.totemWorkloadScope, { mode: "systemd", unit: "totem-codex-test-1.scope" });
  assert.equal(result.kill("SIGINT"), true);
  assert.deepEqual(signals[0].args, ["--user", "kill", "--kill-whom=all", "--signal=SIGINT", "totem-codex-test-1.scope"]);
  assert.deepEqual(child.killCalls, []);
});

test("unavailable systemd uses an explicit direct-spawn fallback", () => {
  const calls = [];
  const warnings = [];
  const child = fakeChild();
  const spawnWorkload = createWorkloadSpawner({
    mode: "auto",
    probeImpl: () => ({ status: 1 }),
    spawnImpl(command, args, options) { calls.push({ command, args, options }); return child; },
    logger: { warn: (message) => warnings.push(message) }
  });
  assert.equal(spawnWorkload.scopeStatus.activeMode, "direct");
  assert.equal(spawnWorkload.scopeStatus.fallback, true);
  assert.equal(spawnWorkload("codex", ["app-server"], { cwd: "/srv" }), child);
  assert.deepEqual(calls, [{ command: "codex", args: ["app-server"], options: { cwd: "/srv" } }]);
  assert.deepEqual(warnings, ["Codex workload scope unavailable; using direct-spawn fallback."]);
});

test("a per-launch scope probe failure uses direct fallback before work starts", () => {
  let probes = 0;
  const calls = [];
  const warnings = [];
  const child = fakeChild();
  const spawnWorkload = createWorkloadSpawner({
    mode: "auto",
    probeImpl: () => ({ status: probes++ < 3 ? 0 : 1, stdout: "available" }),
    spawnImpl(command, args, options) { calls.push({ command, args, options }); return child; },
    logger: { warn: message => warnings.push(message) }
  });
  assert.equal(spawnWorkload("codex", ["app-server"], { cwd: "/srv" }), child);
  assert.deepEqual(calls, [{ command: "codex", args: ["app-server"], options: { cwd: "/srv" } }]);
  assert.deepEqual(warnings, ["Codex workload scope became unavailable; using direct-spawn fallback."]);
});

test("direct mode does not probe or warn", () => {
  let probes = 0;
  const warnings = [];
  const child = fakeChild();
  const spawnWorkload = createWorkloadSpawner({
    mode: "direct",
    probeImpl: () => { probes++; return { status: 0 }; },
    spawnImpl: () => child,
    logger: { warn: (message) => warnings.push(message) }
  });
  assert.equal(spawnWorkload("codex", ["app-server"]), child);
  assert.equal(probes, 0);
  assert.deepEqual(warnings, []);
  assert.deepEqual(spawnWorkload.scopeStatus, { configuredMode: "direct", activeMode: "direct", fallback: false });
});

test("scope signal failure retains the launcher so close cannot release ownership early", () => {
  const warnings = [];
  const child = fakeChild();
  const spawnWorkload = createWorkloadSpawner({
    mode: "systemd",
    probeImpl: () => ({ status: 0 }),
    spawnImpl: () => child,
    signalImpl: () => ({ status: 1 }),
    logger: { warn: (message) => warnings.push(message) },
    unitNameFactory: () => "totem-codex-test-signal.scope"
  });
  const result = spawnWorkload("codex", ["app-server"]);
  assert.equal(result.kill("SIGTERM"), false);
  assert.deepEqual(child.killCalls, []);
  assert.deepEqual(warnings, ["Codex workload scope signal failed; retaining launcher until scope exit."]);
});

test("scope mode and unit names reject shell-like input", () => {
  assert.equal(validateWorkloadScopeMode("AUTO"), "auto");
  assert.throws(() => validateWorkloadScopeMode("systemd; reboot"), /auto, systemd, or direct/);
  assert.equal(validateScopeUnitName("totem-codex-42.scope"), "totem-codex-42.scope");
  assert.throws(() => validateScopeUnitName("totem;reboot.scope"), /bounded systemd/);
  const spawnWorkload = createWorkloadSpawner({
    mode: "systemd",
    probeImpl: () => ({ status: 0 }),
    spawnImpl: () => { throw new Error("spawn must not run"); },
    unitNameFactory: () => "../../unsafe.scope"
  });
  assert.throws(() => spawnWorkload("codex", ["app-server"]), /bounded systemd/);
});

test("synchronous scoped launch failure falls back without changing command data", () => {
  const calls = [];
  const warnings = [];
  const child = fakeChild();
  const spawnWorkload = createWorkloadSpawner({
    mode: "systemd",
    probeImpl: () => ({ status: 0 }),
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      if (command === "systemd-run") throw new Error("unavailable");
      return child;
    },
    logger: { warn: (message) => warnings.push(message) },
    unitNameFactory: () => "totem-codex-test-2.scope"
  });
  const options = { cwd: "/srv", stdio: ["pipe", "pipe", "pipe"] };
  assert.equal(spawnWorkload("codex", ["app-server"], options), child);
  assert.deepEqual(calls.at(-1), { command: "codex", args: ["app-server"], options });
  assert.deepEqual(warnings, ["Codex workload scope launch failed; using direct-spawn fallback."]);
});

for (const failure of ["error"]) {
  test(`asynchronous scoped ${failure} replays buffered stdin through direct fallback`, async () => {
    const calls = [];
    const warnings = [];
    const scoped = fakeChild();
    const direct = fakeChild();
    const received = [];
    direct.stdin.on("data", chunk => received.push(chunk.toString()));
    const spawnWorkload = createWorkloadSpawner({
      mode: "systemd",
      probeImpl: () => ({ status: 0 }),
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        return command === "systemd-run" ? scoped : direct;
      },
      logger: { warn: message => warnings.push(message) },
      unitNameFactory: () => `totem-codex-async-${failure}.scope`
    });
    const result = spawnWorkload("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    result.stdin.write("initialize\n");
    scoped.emit("error", new Error("scope rejected"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.at(-1).command, "codex");
    assert.deepEqual(received, ["initialize\n"]);
    assert.deepEqual(warnings, ["Codex workload scope launch failed; using direct-spawn fallback."]);
    direct.emit("close", 0, null);
  });
}

test("a scoped target nonzero exit is not replayed outside the scope", async () => {
  const calls = [];
  const scoped = fakeChild();
  const spawnWorkload = createWorkloadSpawner({
    mode: "systemd",
    probeImpl: () => ({ status: 0 }),
    spawnImpl(command, args, options) { calls.push({ command, args, options }); return scoped; },
    unitNameFactory: () => "totem-codex-target-failure.scope"
  });
  const result = spawnWorkload("codex", ["app-server"]);
  const closed = new Promise(resolve => result.once("close", resolve));
  scoped.stderr.write("configuration rejected");
  scoped.emit("close", 1, null);
  assert.equal(await closed, 1);
  assert.equal(calls.length, 1);
});

test("scope close waits until systemd reports the signalled unit inactive", async () => {
  const scoped = fakeChild();
  let activeChecks = 0;
  const spawnWorkload = createWorkloadSpawner({
    mode: "systemd",
    probeImpl: () => ({ status: 0 }),
    spawnImpl: () => scoped,
    signalImpl(command, args) {
      if (args.includes("is-active")) return { status: activeChecks++ === 0 ? 0 : 3 };
      return { status: 0 };
    },
    unitNameFactory: () => "totem-codex-wait-inactive.scope"
  });
  const result = spawnWorkload("codex", ["app-server"]);
  let closed = false;
  const done = new Promise(resolve => result.once("close", (...args) => { closed = true; resolve(args); }));
  assert.equal(result.kill("SIGTERM"), true);
  scoped.emit("close", 0, null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  assert.deepEqual(await done, [0, null]);
  assert.equal(activeChecks, 2);
  assert.deepEqual(scoped.killCalls, []);
});

test("scope close treats a failed status probe as unknown rather than inactive", async () => {
  const scoped = fakeChild();
  let activeChecks = 0;
  const spawnWorkload = createWorkloadSpawner({
    mode: "systemd",
    probeImpl: () => ({ status: 0 }),
    spawnImpl: () => scoped,
    signalImpl(command, args) {
      if (args.includes("is-active")) return activeChecks++ === 0
        ? { status: null, error: new Error("timeout") } : { status: 3 };
      return { status: 0 };
    },
    unitNameFactory: () => "totem-codex-probe-error.scope"
  });
  const result = spawnWorkload("codex", ["app-server"]);
  let closed = false;
  const done = new Promise(resolve => result.once("close", () => { closed = true; resolve(); }));
  result.kill("SIGTERM");
  scoped.emit("close", 0, null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  await done;
  assert.equal(activeChecks, 2);
});

test("a throwing direct fallback emits error and closes the proxy", async () => {
  const scoped = fakeChild();
  const spawnWorkload = createWorkloadSpawner({
    mode: "systemd",
    probeImpl: () => ({ status: 0 }),
    spawnImpl(command) {
      if (command === "systemd-run") return scoped;
      throw new Error("direct executable unavailable");
    },
    unitNameFactory: () => "totem-codex-double-failure.scope"
  });
  const result = spawnWorkload("codex", ["app-server"]);
  const error = new Promise(resolve => result.once("error", resolve));
  const closed = new Promise(resolve => result.once("close", resolve));
  scoped.emit("error", new Error("scope rejected"));
  assert.match((await error).message, /direct executable unavailable/);
  assert.equal(await closed, 1);
});

test("confirmed scope output prevents a nonzero target exit from replaying work", async () => {
  const calls = [];
  const scoped = fakeChild();
  const spawnWorkload = createWorkloadSpawner({
    mode: "systemd",
    probeImpl: () => ({ status: 0 }),
    spawnImpl(command, args, options) { calls.push({ command, args, options }); return scoped; },
    unitNameFactory: () => "totem-codex-confirmed.scope"
  });
  const result = spawnWorkload("codex", ["app-server"]);
  const closed = new Promise(resolve => result.once("close", resolve));
  scoped.stdout.write('{"id":1}\n');
  scoped.emit("close", 1, null);
  assert.equal(await closed, 1);
  assert.equal(calls.length, 1);
});
