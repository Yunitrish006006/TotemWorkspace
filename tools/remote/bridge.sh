#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SESSION="${TOTEM_BRIDGE_SESSION:-totem-workspace-bridge}"
HOST="127.0.0.1"
PORT="${TOTEM_BRIDGE_PORT:-18765}"
BACKEND="${TOTEM_BRIDGE_BACKEND:-auto}"
LOG="${TOTEM_BRIDGE_LOG:-$ROOT/.totem-index/remote-bridge.log}"
PID_FILE="${TOTEM_BRIDGE_PID_FILE:-$ROOT/.totem-index/remote-bridge.pid}"
FLUTTER_STAMP="${TOTEM_FLUTTER_STAMP:-$ROOT/.totem-index/flutter-build.sha256}"
FLUTTER_BUILD_MODE="${TOTEM_FLUTTER_BUILD_MODE:-auto}"
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
  TOTEM_BRIDGE_BACKEND=auto|tmux|nohup
  TOTEM_BRIDGE_SESSION=totem-workspace-bridge
  TOTEM_BRIDGE_LOG=.totem-index/remote-bridge.log
  TOTEM_FLUTTER_BUILD_MODE=auto|always|never
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    return 1
  fi
}

tmux_running() {
  command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION" 2>/dev/null
}

pid_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
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

selected_backend() {
  case "$BACKEND" in
    auto)
      if command -v tmux >/dev/null 2>&1; then
        echo "tmux"
      else
        echo "nohup"
      fi
      ;;
    tmux)
      require_command tmux >/dev/null
      echo "tmux"
      ;;
    nohup)
      echo "nohup"
      ;;
    *)
      echo "Invalid TOTEM_BRIDGE_BACKEND: $BACKEND" >&2
      exit 2
      ;;
  esac
}

flutter_fingerprint() {
  node "$ROOT/scripts/flutter-local-build-fingerprint.mjs"
}

flutter_build_ready() {
  [[ -f "$ROOT/viewer_flutter/build/web/index.html" ]] || return 1
  [[ -f "$FLUTTER_STAMP" ]] || return 1
  local expected actual
  expected="$(flutter_fingerprint)"
  actual="$(cat "$FLUTTER_STAMP" 2>/dev/null || true)"
  [[ "$expected" == "$actual" ]]
}

ensure_flutter_build() {
  require_command node
  mkdir -p "$(dirname "$FLUTTER_STAMP")"

  case "$FLUTTER_BUILD_MODE" in
    auto)
      if flutter_build_ready; then
        echo "Flutter viewer: READY (cached build)"
        return 0
      fi
      ;;
    always)
      ;;
    never)
      if [[ -f "$ROOT/viewer_flutter/build/web/index.html" ]]; then
        echo "Flutter viewer: using existing build (freshness check disabled)"
        return 0
      fi
      echo "Flutter viewer build is missing and TOTEM_FLUTTER_BUILD_MODE=never." >&2
      exit 6
      ;;
    *)
      echo "Invalid TOTEM_FLUTTER_BUILD_MODE: $FLUTTER_BUILD_MODE" >&2
      exit 2
      ;;
  esac

  if ! command -v flutter >/dev/null 2>&1; then
    echo "Flutter viewer build is missing or stale, and 'flutter' is not available on the remote host." >&2
    echo "Install Flutter for this user, or provide a current viewer_flutter/build/web and set TOTEM_FLUTTER_BUILD_MODE=never." >&2
    exit 6
  fi

  echo "Flutter viewer: building local root..."
  (
    cd "$ROOT/viewer_flutter"
    flutter pub get
    flutter build web --wasm --base-href /
  )
  flutter_fingerprint > "$FLUTTER_STAMP"
  echo "Flutter viewer: BUILT"
}

show_status() {
  local owner="none"
  if tmux_running; then
    owner="tmux:$SESSION"
  elif pid_running; then
    owner="nohup:$(cat "$PID_FILE")"
  fi
  echo "process: $owner"

  if health_ok; then
    echo "bridge: HEALTHY http://$HOST:$PORT"
    return 0
  elif port_in_use; then
    echo "bridge: PORT $PORT IS IN USE, but Totem Bridge health check failed"
    return 2
  else
    echo "bridge: NOT LISTENING on $HOST:$PORT"
    return 1
  fi
}

start_tmux() {
  tmux new-session -d -s "$SESSION" -c "$ROOT"     "exec node scripts/serve-local-viewer.mjs --port '$PORT' >> '$LOG' 2>&1"
}

start_nohup() {
  (
    cd "$ROOT"
    nohup node scripts/serve-local-viewer.mjs --port "$PORT" >> "$LOG" 2>&1 </dev/null &
    echo "$!" > "$PID_FILE"
  )
}

start_bridge() {
  require_command node
  require_command curl
  ensure_flutter_build

  mkdir -p "$(dirname "$LOG")"
  mkdir -p "$(dirname "$PID_FILE")"

  if tmux_running || pid_running; then
    echo "Totem Bridge background process is already running."
    show_status || true
    return 0
  fi

  if port_in_use; then
    if health_ok; then
      echo "Totem Bridge is already healthy on $HOST:$PORT, but it is not owned by this controller."
      return 0
    fi
    echo "Cannot start Totem Bridge: remote port $PORT is already used by another service." >&2
    exit 3
  fi

  : > "$LOG"
  rm -f "$PID_FILE"

  local backend
  backend="$(selected_backend)"
  case "$backend" in
    tmux) start_tmux ;;
    nohup) start_nohup ;;
  esac

  for _ in $(seq 1 20); do
    if health_ok; then
      echo "Totem Bridge started with backend: $backend"
      [[ "$backend" == "tmux" ]] && echo "tmux session: $SESSION"
      [[ "$backend" == "nohup" ]] && echo "PID: $(cat "$PID_FILE")"
      echo "Remote bridge: http://$HOST:$PORT"
      echo "Log: $LOG"
      return 0
    fi
    if [[ "$backend" == "tmux" ]] && ! tmux_running; then
      echo "Totem Bridge exited during tmux startup." >&2
      tail -n 80 "$LOG" >&2 || true
      exit 4
    fi
    if [[ "$backend" == "nohup" ]] && ! pid_running; then
      echo "Totem Bridge exited during nohup startup." >&2
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
  local stopped=0
  if tmux_running; then
    tmux kill-session -t "$SESSION"
    echo "Stopped tmux session: $SESSION"
    stopped=1
  fi

  if pid_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    echo "Stopped nohup process: $pid"
    stopped=1
  elif [[ -f "$PID_FILE" ]]; then
    rm -f "$PID_FILE"
  fi

  if [[ "$stopped" -eq 0 ]]; then
    echo "Totem Bridge controller has no running background process."
  fi
}

doctor() {
  local failed=0
  for cmd in node curl; do
    if command -v "$cmd" >/dev/null 2>&1; then
      echo "$cmd: OK ($(command -v "$cmd"))"
    else
      echo "$cmd: MISSING"
      failed=1
    fi
  done

  if command -v tmux >/dev/null 2>&1; then
    echo "tmux: OK ($(command -v tmux))"
    echo "background backend: tmux (auto preference)"
  else
    echo "tmux: MISSING (not fatal)"
    echo "background backend: nohup fallback"
  fi

  echo "workspace: $ROOT"
  echo "session: $SESSION"
  echo "port: $PORT"
  echo "log: $LOG"
  echo "pid file: $PID_FILE"
  echo "flutter build mode: $FLUTTER_BUILD_MODE"
  if flutter_build_ready; then
    echo "flutter viewer: READY"
  elif [[ -f "$ROOT/viewer_flutter/build/web/index.html" ]]; then
    echo "flutter viewer: STALE"
  elif command -v flutter >/dev/null 2>&1; then
    echo "flutter viewer: MISSING (will build on start)"
  else
    echo "flutter viewer: MISSING and flutter command unavailable"
    failed=1
  fi

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
    if tmux_running; then
      exec tmux attach-session -t "$SESSION"
    fi
    echo "No tmux Bridge session is running. If the Bridge uses nohup, use 'follow' for live logs." >&2
    exit 1
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
