#!/usr/bin/env bash
# Builds and starts the DuelingChaos backend (Node bridge + Java Forge shim)
# as a detached background process. Always rebuilds first — the backend has
# shipped stale before when dist/ wasn't regenerated after a src/ edit.
set -euo pipefail
cd "$(dirname "$0")/.."

PID_FILE=".backend.pid"
LOG_FILE="backend.log"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Backend already running (PID $(cat "$PID_FILE")). Run scripts/stop-backend.sh first."
  exit 1
fi

echo "Building backend (tsc)..."
npm run build

echo "Building bridge shim (javac)..."
npm run build:shim

echo "Starting backend..."
echo "===== $(date '+%Y-%m-%d %H:%M:%S') backend start =====" >> "$LOG_FILE"
node scripts/detached-start.js
sleep 1

if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Backend failed to start — check $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi

echo "Backend running (PID $(cat "$PID_FILE")). Logs: $LOG_FILE"
