#!/bin/bash
# Monitor Status Script

cd /workspace/host/var/www/retakt

if [ ! -f logs/ai-monitor.log ]; then
  echo "Monitor log not found. Is the monitor running?"
  echo "Start it with: start-monitor"
  exit 1
fi

echo "=== AI Monitor Status ==="
echo ""

if [ -f logs/ai-monitor.pid ]; then
  PID=$(cat logs/ai-monitor.pid)
  if kill -0 "$PID" 2>/dev/null; then
    echo "Status: ✓ RUNNING (PID: $PID)"
  else
    echo "Status: ✗ STOPPED (stale PID file)"
  fi
else
  echo "Status: ✗ NOT STARTED"
fi

echo ""
echo "=== Recent Logs (last 30 lines) ==="
echo ""
tail -n 30 logs/ai-monitor.log
