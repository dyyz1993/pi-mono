#!/bin/bash

set -e

PORT=3000

setup_loopback() {
  echo "==> Setting up loopback aliases..."
  local aliases=("127.0.0.2" "127.0.0.3" "127.0.0.4" "127.0.0.5")
  for ip in "${aliases[@]}"; do
    if ifconfig lo0 | grep -q "$ip"; then
      echo "  Exists: $ip"
    else
      echo "  Adding: $ip"
      sudo ifconfig lo0 alias "$ip" up 2>/dev/null || {
        echo "  FAILED: $ip - check sudo or Full Disk Access permission"
      }
    fi
  done
  echo ""
  echo "Current loopback interfaces:"
  ifconfig lo0 | grep 'inet ' | grep -v 'netmask'
}

teardown_loopback() {
  echo "==> Tearing down loopback aliases..."
  local aliases=("127.0.0.2" "127.0.0.3" "127.0.0.4" "127.0.0.5")
  for ip in "${aliases[@]}"; do
    if ifconfig lo0 | grep -q "$ip"; then
      sudo ifconfig lo0 -alias "$ip" 2>/dev/null && echo "  Removed: $ip" || true
    fi
  done
}

start_server() {
  local name="$1"
  local ip="$2"
  local pid_file="/tmp/worktree-${name}.pid"

  if [ -f "$pid_file" ]; then
    if kill -0 "$(cat "$pid_file")" 2>/dev/null; then
      echo "  [${name}] Already running on http://${ip}:${PORT} (PID: $(cat $pid_file))"
      return 0
    fi
    rm -f "$pid_file"
  fi

  (WORKTREE_NAME="$name" python3 -c "
import http.server
import socketserver
import json
import os

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        info = {
            'worktree': os.environ.get('WORKTREE_NAME', 'unknown'),
            'ip': '${ip}',
            'port': ${PORT},
            'pid': ${$}
        }
        self.wfile.write(json.dumps(info, indent=2).encode())

with socketserver.TCPServer(('${ip}', ${PORT}), Handler) as httpd:
    httpd.serve_forever()
" &) &

  local pid=$!
  echo $pid > "$pid_file"
  sleep 0.3

  if kill -0 "$pid" 2>/dev/null; then
    echo "  [${name}] Started on http://${ip}:${PORT} (PID: $pid)"
  else
    echo "  [${name}] FAILED to start on http://${ip}:${PORT}"
    rm -f "$pid_file"
  fi
}

stop_all() {
  echo "==> Stopping all worktree servers..."
  for pid_file in /tmp/worktree-*.pid; do
    [ -f "$pid_file" ] || continue
    local pid=$(cat "$pid_file")
    local name=$(basename "$pid_file" .pid | sed 's/worktree-//')
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && echo "  Stopped: $name (PID: $pid)"
    fi
    rm -f "$pid_file"
  done
}

status() {
  echo "==> Worktree servers status:"
  for pid_file in /tmp/worktree-*.pid; do
    [ -f "$pid_file" ] || continue
    local pid=$(cat "$pid_file")
    local name=$(basename "$pid_file" .pid | sed 's/worktree-//')
    if kill -0 "$pid" 2>/dev/null; then
      echo "  [${name}] Running (PID: $pid)"
    else
      echo "  [${name}] Dead (stale PID file)"
    fi
  done
}

case "${1:-start}" in
  start)
    stop_all 2>/dev/null || true
    setup_loopback

    echo "==> Starting worktree servers on SAME port ${PORT} with different IPs..."
    start_server "main"      "127.0.0.1"
    start_server "feature-a" "127.0.0.2"
    start_server "feature-b" "127.0.0.3"

    echo ""
    echo "==> Testing all endpoints (same port, different IPs):"
    sleep 1
    for ip in 127.0.0.1 127.0.0.2 127.0.0.3; do
      echo -n "  http://${ip}:${PORT} -> "
      curl -s "http://${ip}:${PORT}" 2>/dev/null | head -c 100 || echo "FAILED"
      echo ""
    done
    ;;
  stop)
    stop_all
    ;;
  status)
    status
    ;;
  cleanup)
    stop_all
    teardown_loopback
    ;;
  *)
    echo "Usage: $0 {start|stop|status|cleanup}"
    exit 1
    ;;
esac
