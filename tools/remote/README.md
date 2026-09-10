# Remote SSH Bridge

This directory contains remote-development helpers for TotemWorkspace.

Supported topology:

```text
Mac browser
  -> 127.0.0.1:18765/
  -> Flutter production UI
  -> /api/* Local Bridge API
  -> VS Code Remote-SSH LocalForward
  -> remote 127.0.0.1:18765
```

The Bridge remains loopback-only. Do not bind it to `0.0.0.0`. The retired browser JavaScript viewer and `/legacy/` surface are no longer part of the remote setup.

## macOS SSH config

```sshconfig
Host csvr.4hotel.tw
    HostName csvr.4hotel.tw
    User thomas
    LocalForward 127.0.0.1:18765 127.0.0.1:18765
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

Reconnect VS Code Remote-SSH after changing `~/.ssh/config`.

## Remote server

From a VS Code terminal connected to the remote server:

```bash
bash tools/remote/bridge.sh doctor
bash tools/remote/bridge.sh start
```

On `start`, the controller fingerprints `viewer_flutter/`. If the local web build is missing or stale, it resolves Flutter first. A system/user PATH Flutter is preferred; otherwise the pinned SDK is installed in user space at:

```text
~/.local/share/totem-workspace/flutter/3.47.0
```

This bootstrap uses only the current user's files and sudo is not required.

Explicit bootstrap:

```bash
bash tools/remote/bootstrap-flutter.sh install
```

The controller then builds:

```bash
cd viewer_flutter
flutter pub get
flutter build web --wasm --base-href /
```

A matching build is reused on restart. The build stamp lives under ignored `.totem-index/`.

After startup:

```text
http://127.0.0.1:18765/         Flutter
http://127.0.0.1:18765/api/...  Local Bridge API
```

There is no `/legacy/` Viewer.

## Bridge commands

The default tmux session is `totem-workspace-bridge` and the default port is `18765`.

```bash
bash tools/remote/bridge.sh start
bash tools/remote/bridge.sh status
bash tools/remote/bridge.sh logs
bash tools/remote/bridge.sh follow
bash tools/remote/bridge.sh attach
bash tools/remote/bridge.sh restart
bash tools/remote/bridge.sh stop
```

Logs are stored at `.totem-index/remote-bridge.log`.

### Custom port

```bash
TOTEM_BRIDGE_PORT=19001 bash tools/remote/bridge.sh start
```

The Mac `LocalForward` and Viewer API port must use the same local port.

## VS Code tasks

After Remote-SSH connects:

```text
Command Palette
-> Tasks: Run Task
-> Totem: Start Bridge
```

The task executes on the remote host because the VS Code workspace is opened through Remote-SSH.

## Background backend

The controller uses:

```text
auto
  ├─ tmux, when installed
  └─ nohup + .totem-index/remote-bridge.pid, otherwise
```

So sudo is not required just to keep the Bridge running. Check the selected backend with:

```bash
bash tools/remote/bridge.sh doctor
```

Override when debugging:

```bash
TOTEM_BRIDGE_BACKEND=tmux bash tools/remote/bridge.sh start
TOTEM_BRIDGE_BACKEND=nohup bash tools/remote/bridge.sh start
```

`attach` is available only for the tmux backend. For nohup use `logs` or `follow`.

## Flutter build modes

Default:

```text
TOTEM_FLUTTER_BUILD_MODE=auto
```

- `auto`: rebuild only when the Flutter source fingerprint changes.
- `always`: rebuild on every Bridge start.
- `never`: never invoke Flutter; requires an existing `viewer_flutter/build/web/index.html`.

If the account does not have Flutter installed, `TOTEM_FLUTTER_BOOTSTRAP=auto` installs Flutter 3.47.0 under the user's data directory. Set `TOTEM_FLUTTER_BOOTSTRAP=never` only when startup should fail instead of bootstrapping the SDK.

## Codex Agent Adapter

Agent execution remains opt-in. The Bridge defaults to:

```text
TOTEM_AGENT_ADAPTER=off
```

Enable the shared Codex runtime:

```bash
export TOTEM_AGENT_ADAPTER=codex
export TOTEM_CODEX_BIN=codex
export TOTEM_CODEX_CWD="$HOME/workspace"
export TOTEM_CODEX_SANDBOX=workspace-write
# Optional:
# export TOTEM_CODEX_MODEL=<model-id>

node scripts/totem-runtime.mjs capabilities
bash tools/remote/bridge.sh doctor
bash tools/remote/bridge.sh restart
node scripts/totem-activity.mjs prompt on
node scripts/totem-activity.mjs status
```

`TOTEM_CODEX_CWD` must resolve inside the Totem workspace. The shared planner derives permitted module write roots. Browser payloads cannot choose executable, working directory, sandbox, model or CLI flags.

The adapter uses the shared `intelligence/agent-runtime/` Codex App Server implementation, including thread start/resume, turn start/steer, cancellation, approvals and actual model/usage events. Authentication remains owned by the remote operating-system user; unsupported transport approvals are declined, never bypassed.

A successful CLI version probe alone is insufficient; `node scripts/totem-runtime.mjs capabilities` checks live CLI/App Server/model catalog/MCP/intelligence readiness. Model hints are preferences and the runtime catalog controls fallback.

Sandbox roots enforce module scope. In-process leases reject overlapping roots; `.totem-index/runtime-write-leases/` conservatively serializes writes across Bridge, Discord and CLI processes sharing the checkout. Stale or unknown owners fail closed.

Useful endpoints:

```text
GET /api/agent-adapter
GET /api/activity
POST /api/prompt
```

Expected task states:

```text
ADAPTER OFF       host has not enabled dispatch
CODEX UNAVAILABLE adapter requested but runtime capability probe failed
RUNNING           submitted task is active
COMPLETED         previous task finished successfully
FAILED            previous task terminated with an error
INTERRUPTED       replay has a running task but the current Bridge no longer owns it
```

`bash tools/remote/bridge.sh status` reports the same lifecycle. Replay provides persistent fallback across browser reloads and Bridge restarts.

## Development Replay

Replay state is local to the remote checkout:

```text
.totem-index/development-replay.json
```

Inspect it without opening Flutter:

```bash
node scripts/totem-activity.mjs status
node scripts/totem-activity.mjs replay
node scripts/totem-activity.mjs replay 42
```

Flutter exposes the same replay timeline and `LIVE` return path through the loopback Bridge.

## Safe restart / redeploy

A normal `stop` or `restart` refuses to shut down the Local Bridge while Codex is BUSY:

```bash
bash tools/remote/bridge.sh status
bash tools/remote/bridge.sh restart
```

Emergency override only:

```bash
TOTEM_BRIDGE_FORCE=1 bash tools/remote/bridge.sh restart
```

A forced shutdown records the interrupted/failed task state before terminating the runtime. Deploying the GitHub Pages frontend does not stop the remote Local Bridge or its active Codex task.
