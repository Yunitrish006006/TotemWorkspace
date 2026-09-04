#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SESSION="${TOTEM_BRIDGE_SESSION:-totem-workspace-bridge}"
HOST="127.0.0.1"
PORT="${TOTEM_BRIDGE_PORT:-18765}"
LOG="${TOTEM_BRIDGE_LOG:-$ROOT/.totem-index/remote-bridge.log}"
ACTION="${1:-status}"

usage() {
  cat <<'EOF'
TotemWorkspace remote bridge controller

Usage:
  bash tools/remote/bridge.sh start
  bash tools/remote/bridge.sh stop
  bash tools/remote/bridge.sh restart
  bash tools/remote/bridge.sh status
  bash tools/remote/bridge.sh logs
  bash tools/remote/bridge.sh follow
  bash tools/remote/bridge.sh attach
  bash tools/remote/bridge.sh doctor

Environment:
  TOTEM_BRIDGE_PORT=18765
  TOTEM_BRIDGE_SESSION=totem-workspace-bridge
  TOTEM_BRIDGE_LOG=.totem-index/remote-bridge.log
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    return 1
  fi
}

session_running() {
  tmux has-session -t "$SESSION" 2>/dev/null
}

health_ok() {
  curl -fsS --max-time 1 "http://$HOST:$PORT/api/health" 2>/dev/null |
    grep -q '"mode"[[:space:]]*:[[:space:]]*"local"'
}

port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -H -ltn "sport = :$PORT" 2>/dev/null | grep -q .
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  return 1
}

show_status() {
  if session_running; then
    echo "tmux: RUNNING ($SESSION)"
  else
    echo "tmux: STOPPED ($SESSION)"
  fi

  if health_ok; then
    echo "bridge: HEALTHY http://$HOST:$PORT"
  elif port_in_use; then
    echo "bridge: PORT $PORT IS IN USE, but Totem Bridge health check failed"
    return 2
  else
    echo "bridge: NOT LISTENING on $HOST:$PORT"
    return 1
  fi
}

start_bridge() {
  require_command tmux
  require_command node
  require_command curl

  mkdir -p "$(dirname "$LOG")"

  if session_running; then
    echo "Totem Bridge tmux session is already running: $SESSION"
    show_status || true
    return 0
  fi

  if port_in_use; then
    if health_ok; then
      echo "Totem Bridge is already healthy on $HOST:$PORT, but no tmux session named $SESSION owns it."
      return 0
    fi
    echo "Cannot start Totem Bridge: remote port $PORT is already used by another service." >&2
    exit 3
  fi

  : > "$LOG"
  tmux new-session -d -s "$SESSION" -c "$ROOT"     "exec node scripts/serve-local-viewer.mjs --port '$PORT' >> '$LOG' 2>&1"

  for _ in $(seq 1 20); do
    if health_ok; then
      echo "Totem Bridge started in tmux session: $SESSION"
      echo "Remote bridge: http://$HOST:$PORT"
      echo "Log: $LOG"
      return 0
    fi
    if ! session_running; then
      echo "Totem Bridge exited during startup." >&2
      tail -n 80 "$LOG" >&2 || true
      exit 4
    fi
    sleep 0.25
  done

  echo "Totem Bridge did not become healthy in time." >&2
  tail -n 80 "$LOG" >&2 || true
  exit 5
}

stop_bridge() {
  require_command tmux
  if ! session_running; then
    echo "Totem Bridge tmux session is already stopped: $SESSION"
    return 0
  fi
  tmux kill-session -t "$SESSION"
  echo "Totem Bridge stopped: $SESSION"
}

doctor() {
  local failed=0
  for cmd in tmux node curl; do
    if command -v "$cmd" >/dev/null 2>&1; then
      echo "$cmd: OK ($(command -v "$cmd"))"
    else
      echo "$cmd: MISSING"
      failed=1
    fi
  done
  echo "workspace: $ROOT"
  echo "session: $SESSION"
  echo "port: $PORT"
  echo "log: $LOG"
  if port_in_use; then
    if health_ok; then
      echo "port check: Totem Bridge is already listening"
    else
      echo "port check: $PORT is occupied by another service"
      failed=1
    fi
  else
    echo "port check: $PORT is available"
  fi
  return "$failed"
}

case "$ACTION" in
  start)
    start_bridge
    ;;
  stop)
    stop_bridge
    ;;
  restart)
    stop_bridge
    start_bridge
    ;;
  status)
    require_command tmux
    require_command curl
    show_status
    ;;
  logs)
    if [[ -f "$LOG" ]]; then
      tail -n 120 "$LOG"
    else
      echo "No bridge log yet: $LOG"
    fi
    ;;
  follow)
    mkdir -p "$(dirname "$LOG")"
    touch "$LOG"
    tail -f "$LOG"
    ;;
  attach)
    require_command tmux
    exec tmux attach-session -t "$SESSION"
    ;;
  doctor)
    doctor
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    usage >&2
    exit 2
    ;;
esac
