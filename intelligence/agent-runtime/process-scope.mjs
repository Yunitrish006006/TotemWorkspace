import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const SCOPE_MODES = new Set(["auto", "systemd", "direct"]);
const SCOPE_UNIT = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,119}\.scope$/;

export function validateWorkloadScopeMode(value) {
  const mode = String(value ?? "auto").trim().toLowerCase();
  if (!SCOPE_MODES.has(mode)) throw new Error("CODEX_WORKLOAD_SCOPE_MODE must be auto, systemd, or direct");
  return mode;
}

export function validateScopeUnitName(value) {
  if (typeof value !== "string" || !SCOPE_UNIT.test(value)) {
    throw new Error("Workload scope unit must be a bounded systemd .scope name");
  }
  return value;
}

function probeSystemdUser({ probeImpl, env }) {
  try {
    const manager = probeImpl("systemctl", ["--user", "show", "--property=Version", "--value"], {
      env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3_000
    });
    if (manager?.status !== 0) return false;
    const runner = probeImpl("systemd-run", ["--version"], {
      env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3_000
    });
    if (runner?.status !== 0) return false;
    const scope = probeImpl("systemd-run", [
      "--user", "--scope", "--quiet", "--collect",
      `--unit=totem-codex-probe-${process.pid}.scope`, "--", "true"
    ], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3_000 });
    return scope?.status === 0;
  } catch {
    return false;
  }
}

function warn(logger, message) {
  try { logger?.warn?.(message); } catch { /* Logging cannot prevent the safe fallback. */ }
}

function proxyScopedChild({ scopedChild, command, args, options, spawnImpl, signalImpl, env, logger, unit }) {
  const proxy = new EventEmitter();
  proxy.stdin = new PassThrough();
  proxy.stdout = new PassThrough();
  proxy.stderr = new PassThrough();
  let current = null;
  let currentKind = null;
  let confirmed = false;
  let fallbackStarted = false;
  let cancelled = false;
  let settled = false;
  let inputEnded = false;
  let replay = [];
  let scopeSignalPending = false;

  const finish = (code, signal) => {
    if (settled) return;
    settled = true;
    proxy.stdout.end();
    proxy.stderr.end();
    proxy.emit("close", code, signal);
  };
  const finishWhenScopeInactive = (code, signal, attempt = 0) => {
    let active = true;
    try {
      const result = signalImpl("systemctl", ["--user", "is-active", "--quiet", unit], {
        env, stdio: "ignore", timeout: 3_000
      });
      active = result?.error || result?.signal || result?.status == null ? true : result.status === 0;
    } catch { /* An unavailable manager cannot prove the workload stopped. */ }
    if (!active) { finish(code, signal); return; }
    const delay = attempt < 80 ? 50 : 1_000;
    setTimeout(() => finishWhenScopeInactive(code, signal, Math.min(attempt + 1, 81)), delay);
  };
  const connect = (child, kind) => {
    current = child;
    currentKind = kind;
    child.stdout?.on("data", chunk => {
      if (kind === "scope" && !confirmed) {
        confirmed = true;
        replay = [];
      }
      proxy.stdout.write(chunk);
    });
    child.stderr?.on("data", chunk => proxy.stderr.write(chunk));
    child.once("error", error => {
      if (kind === "scope" && !confirmed && !cancelled) startFallback();
      else proxy.emit("error", error);
    });
    child.once("close", (code, signal) => {
      if (child !== current) return;
      if (kind === "scope" && scopeSignalPending) finishWhenScopeInactive(code, signal);
      else finish(code, signal);
    });
  };
  const startFallback = () => {
    if (fallbackStarted || settled) return;
    fallbackStarted = true;
    warn(logger, "Codex workload scope launch failed; using direct-spawn fallback.");
    let direct;
    try {
      direct = spawnImpl(command, args, options);
    } catch (error) {
      queueMicrotask(() => {
        proxy.emit("error", error);
        finish(1, null);
      });
      return;
    }
    connect(direct, "direct");
    for (const chunk of replay) direct.stdin?.write?.(chunk);
    replay = [];
    if (inputEnded) direct.stdin?.end?.();
  };

  proxy.stdin.on("data", chunk => {
    const copy = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk));
    if (currentKind === "scope" && !confirmed) replay.push(copy);
    current?.stdin?.write?.(chunk);
  });
  proxy.stdin.on("end", () => {
    inputEnded = true;
    current?.stdin?.end?.();
  });
  const signalScope = (signal, whom) => {
    cancelled = true;
    let scopeSignalled = false;
    if (currentKind === "scope") {
      try {
        const result = signalImpl("systemctl", [
          "--user", "kill", `--kill-whom=${whom}`, `--signal=${signal}`, unit
        ], { env, stdio: "ignore", timeout: 3_000 });
        scopeSignalled = result?.status === 0;
        if (scopeSignalled) scopeSignalPending = true;
        if (!scopeSignalled) warn(logger, "Codex workload scope signal failed; retaining launcher until scope exit.");
      } catch {
        warn(logger, "Codex workload scope signal failed; retaining launcher until scope exit.");
      }
    }
    if (currentKind === "scope") return scopeSignalled;
    return current?.kill?.(signal) ?? false;
  };
  proxy.kill = (signal = "SIGTERM") => signalScope(signal, "all");
  Object.defineProperties(proxy, {
    killed: { get: () => cancelled || current?.killed === true },
    pid: { get: () => current?.pid },
    totemWorkloadScope: { value: Object.freeze({ mode: "systemd", unit }), enumerable: false }
  });
  connect(scopedChild, "scope");
  return proxy;
}

export function createWorkloadSpawner({
  mode = "auto",
  spawnImpl = spawn,
  probeImpl = spawnSync,
  signalImpl = spawnSync,
  env = process.env,
  logger = console,
  unitNameFactory
} = {}) {
  const configuredMode = validateWorkloadScopeMode(mode);
  const systemdAvailable = configuredMode !== "direct" && probeSystemdUser({ probeImpl, env });
  let sequence = 0;
  const makeUnitName = unitNameFactory ?? (() => `totem-codex-${process.pid}-${++sequence}.scope`);

  if (configuredMode !== "direct" && !systemdAvailable) {
    warn(logger, "Codex workload scope unavailable; using direct-spawn fallback.");
  }

  const spawnWorkload = (command, args = [], options = {}) => {
    if (!systemdAvailable) return spawnImpl(command, args, options);
    if (!probeSystemdUser({ probeImpl, env })) {
      warn(logger, "Codex workload scope became unavailable; using direct-spawn fallback.");
      return spawnImpl(command, args, options);
    }
    const unit = validateScopeUnitName(makeUnitName());
    let child;
    try {
      child = spawnImpl("systemd-run", [
        "--user", "--scope", "--quiet", "--collect", `--unit=${unit}`, "--", command, ...args
      ], options);
    } catch {
      warn(logger, "Codex workload scope launch failed; using direct-spawn fallback.");
      return spawnImpl(command, args, options);
    }

    return proxyScopedChild({ scopedChild: child, command, args, options,
      spawnImpl, signalImpl, env, logger, unit });
  };

  Object.defineProperty(spawnWorkload, "scopeStatus", {
    value: Object.freeze({
      configuredMode,
      activeMode: systemdAvailable ? "systemd" : "direct",
      fallback: configuredMode !== "direct" && !systemdAvailable
    }),
    enumerable: true
  });
  return spawnWorkload;
}
