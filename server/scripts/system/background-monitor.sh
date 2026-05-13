#!/bin/bash
# Background Monitor Script

cd /workspace/host/var/www/retakt
mkdir -p logs

if [ -f logs/ai-monitor.pid ]; then
  PID=$(cat logs/ai-monitor.pid)
  if kill -0 "$PID" 2>/dev/null; then
    echo "Monitor already running (PID: $PID)"
    exit 0
  fi
fi

cat > /tmp/monitor-script.sh << 'MONITOR_EOF'
#!/bin/bash
echo $$ > logs/ai-monitor.pid

while true; do
  {
    echo "================================================================"
    echo "  Health Check - $(date '+%Y-%m-%d %H:%M:%S')"
    echo "================================================================"
    echo ""
    echo "[AI Services]"

    start=$(date +%s%3N)
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://chat-api.retakt.cc/api/tags" 2>/dev/null)
    end=$(date +%s%3N)
    time=$((end - start))
    if [ "$code" = "200" ]; then
      printf "  ● %-25s READY   %5dms  HTTP %s\n" "AI Model" "$time" "$code"
    else
      printf "  ● %-25s DOWN\n" "AI Model"
    fi

    start=$(date +%s%3N)
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://search-api.retakt.cc/search?q=test&format=json" 2>/dev/null)
    end=$(date +%s%3N)
    time=$((end - start))
    if [ "$code" = "200" ]; then
      printf "  ● %-25s READY   %5dms  HTTP %s\n" "Web Search" "$time" "$code"
    else
      printf "  ● %-25s DOWN\n" "Web Search"
    fi

    echo ""
  } >> logs/ai-monitor.log

  tail -n 2000 logs/ai-monitor.log > logs/ai-monitor.log.tmp 2>/dev/null && mv logs/ai-monitor.log.tmp logs/ai-monitor.log
  sleep 30
done
MONITOR_EOF

chmod +x /tmp/monitor-script.sh
nohup /tmp/monitor-script.sh > /dev/null 2>&1 &

sleep 2

if [ -f logs/ai-monitor.pid ]; then
  PID=$(cat logs/ai-monitor.pid)
  if kill -0 "$PID" 2>/dev/null; then
    echo "Monitor started successfully (PID: $PID)"
    echo "Checking services every 30 seconds"
    echo "Use 'show-monitor' to view logs"
  else
    echo "Failed to start monitor"
    exit 1
  fi
else
  echo "Failed to start monitor"
  exit 1
fi
