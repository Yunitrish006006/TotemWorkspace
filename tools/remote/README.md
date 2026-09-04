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
