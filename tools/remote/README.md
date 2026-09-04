# Remote SSH Bridge

This directory contains remote-development helpers for TotemWorkspace.

The supported setup is:

```text
Mac browser
  -> 127.0.0.1:18765
  -> VS Code Remote-SSH LocalForward
  -> remote 127.0.0.1:18765
  -> TotemWorkspace Bridge in tmux
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

## tmux requirement

Check first:

```bash
tmux -V
```

If `tmux` is not installed and the account cannot use sudo, an administrator needs to install it or provide an equivalent user-level process supervisor.
