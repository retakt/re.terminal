#!/bin/bash
# Stop Background Monitor

cd /workspace/host/var/www/retakt

if [ ! -f logs/ai-monitor.pid ]; then
  echo "Monitor is not running (no PID file found)"
  exit 0
fi

PID=$(cat logs/ai-monitor.pid)

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  rm -f logs/ai-monitor.pid
  echo "✓ Monitor stopped (PID: $PID)"
else
  rm -f logs/ai-monitor.pid
  echo "Monitor was not running (stale PID file removed)"
fi
