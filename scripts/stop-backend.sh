#!/usr/bin/env bash
# Stops the DuelingChaos backend started by scripts/start-backend.sh.
# A plain SIGTERM to the Node process is enough on its own — src/index.ts's
# shutdown handler kills its Java bridge-shim child in response — but this
# also sweeps for an orphaned BridgeMain process as a safety net, in case
# the backend was ever started some other way (e.g. a manually detached
# node process) that isn't the Java process's real parent.
set -euo pipefail
cd "$(dirname "$0")/.."

PID_FILE=".backend.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping backend (PID $PID)..."
    kill "$PID"
    for _ in $(seq 1 10); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$PID" 2>/dev/null; then
      echo "Backend didn't exit cleanly — forcing."
      kill -9 "$PID" 2>/dev/null || true
    fi
  else
    echo "PID $PID from $PID_FILE isn't running."
  fi
  rm -f "$PID_FILE"
else
  echo "No $PID_FILE found — checking for stray processes..."
fi

if pkill -f "dev.duelingchaos.bridge.BridgeMain" 2>/dev/null; then
  echo "Stopped orphaned bridge-shim process(es)."
fi

echo "Backend stopped."
