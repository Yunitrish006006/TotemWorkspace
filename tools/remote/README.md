# Remote SSH Bridge

This directory contains remote-development helpers for TotemWorkspace.

The supported setup is:

```text
Mac browser
  -> 127.0.0.1:18765/
  -> Flutter production UI
  -> /api/* local workspace API
  -> /legacy/ JavaScript rollback/debug viewer
  -> VS Code Remote-SSH LocalForward
  -> remote 127.0.0.1:18765
```

The Bridge remains loopback-only. Do not bind it to `0.0.0.0`.

## macOS SSH config

On the Mac:

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

On `start`, the controller fingerprints `viewer_flutter/`. If the local web build is missing or stale, it first resolves Flutter. A system/user PATH Flutter is preferred; otherwise it automatically installs the pinned SDK in user space:

```text
~/.local/share/totem-workspace/flutter/3.47.0
```

This bootstrap uses only the current user's files and does **not** require sudo.

You can also bootstrap explicitly:

```bash
bash tools/remote/bootstrap-flutter.sh install
```

Then it runs:

```bash
cd viewer_flutter
flutter pub get
flutter build web --wasm --base-href /
```

A matching build is reused on restart. The build stamp lives under ignored `.totem-index/`.

After startup:

```text
http://127.0.0.1:18765/         Flutter
http://127.0.0.1:18765/legacy/  Legacy JavaScript viewer
http://127.0.0.1:18765/api/...  Local Bridge API
```

The default tmux session is:

```text
totem-workspace-bridge
```

The default Bridge port is:

```text
18765
```

Commands:

```bash
bash tools/remote/bridge.sh start
bash tools/remote/bridge.sh status
bash tools/remote/bridge.sh logs
bash tools/remote/bridge.sh follow
bash tools/remote/bridge.sh attach
bash tools/remote/bridge.sh restart
bash tools/remote/bridge.sh stop
```

The log is stored in ignored local state:

```text
.totem-index/remote-bridge.log
```

## Custom port

Override the remote Bridge port without modifying the script:

```bash
TOTEM_BRIDGE_PORT=19001 bash tools/remote/bridge.sh start
```

The Mac `LocalForward` and Viewer local API port must use the same local port.

## VS Code tasks

The repository includes shared VS Code tasks. After Remote-SSH connects:

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

You can force a backend when debugging:

```bash
TOTEM_BRIDGE_BACKEND=tmux bash tools/remote/bridge.sh start
TOTEM_BRIDGE_BACKEND=nohup bash tools/remote/bridge.sh start
```

`attach` is available only for the tmux backend. For the nohup backend use `logs` or `follow`.

## Flutter build modes

Default:

```text
TOTEM_FLUTTER_BUILD_MODE=auto
```

- `auto`: rebuild only when the Flutter source fingerprint changes.
- `always`: rebuild on every Bridge start.
- `never`: never invoke Flutter; requires an existing `viewer_flutter/build/web/index.html`.

If the remote account does not have Flutter installed yet, the default `TOTEM_FLUTTER_BOOTSTRAP=auto` installs Flutter 3.47.0 under the user's data directory on first start. Set `TOTEM_FLUTTER_BOOTSTRAP=never` only when you intentionally want startup to fail instead of downloading the SDK.

The first bootstrap downloads the Flutter SDK and web artifacts, so it is much heavier than later restarts. Subsequent starts reuse the SDK and only rebuild the viewer when its fingerprint changes.


## Codex Agent Adapter

Phase 5 keeps agent execution opt-in. The Bridge defaults to:

```text
TOTEM_AGENT_ADAPTER=off
```

To dispatch Viewer prompts to the Codex CLI on the remote host:

```bash
codex --version

export TOTEM_AGENT_ADAPTER=codex
export TOTEM_CODEX_BIN=codex
export TOTEM_CODEX_CWD="$HOME/workspace"
export TOTEM_CODEX_SANDBOX=workspace-write
# Optional:
# export TOTEM_CODEX_MODEL=<model-id>

bash tools/remote/bridge.sh doctor
bash tools/remote/bridge.sh restart
node scripts/totem-activity.mjs prompt on
node scripts/totem-activity.mjs status
```

`TOTEM_CODEX_CWD` must resolve inside the Totem workspace. For the current sibling-repository layout, the common parent directory is the useful write boundary. The adapter invokes Codex with structured argv and sends the Prompt over stdin; browser payloads cannot choose the executable, working directory, sandbox, model, or CLI flags.

The adapter uses `codex exec --json` and consumes JSONL lifecycle/items. It does **not** force `--full-auto` or `--dangerously-bypass-approvals-and-sandbox`; Codex approval/auth configuration remains owned by the remote operating-system user.

Useful endpoints:

```text
GET /api/agent-adapter
GET /api/activity
POST /api/prompt
```

Expected Viewer states:

```text
ADAPTER OFF       host has not enabled dispatch
CODEX UNAVAILABLE adapter requested but Codex probe failed
CODEX READY       Prompt can start a task
CODEX BUSY        one task is already running
```

Phase 5 allows one active task at a time. When a task settles, the Bridge automatically refreshes the code index, generated graph data, and Phase 3 change intelligence.

## Development Replay

Phase 6 replay state is local to the remote TotemWorkspace checkout:

```text
.totem-index/development-replay.json
```

It survives Bridge/tmux restarts and is ignored by Git. Check the current replay
range without opening the Viewer:

```bash
node scripts/totem-activity.mjs status
node scripts/totem-activity.mjs replay
node scripts/totem-activity.mjs replay 42
```

In the Flutter root and `/legacy/`, use the REPLAY slider to select an historical
activity sequence and press `LIVE` to return to current state. The browser still
talks only to the loopback Bridge through the existing SSH port forward.
