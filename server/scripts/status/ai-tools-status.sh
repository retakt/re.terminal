#!/bin/bash
# AI Tools Status

response=$(curl -s -w "\n%{http_code}" --max-time 5 "http://localhost:3002/status" 2>/dev/null)
http_code=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
  echo "=== AI Tools Status ($(date '+%H:%M:%S')) ==="
  echo ""

  if command -v jq >/dev/null 2>&1; then
    echo "$body" | jq -r '.services[] | "● \(.name | .[0:20])  \(.status | .[0:8])  \(if .responseTime then (.responseTime | tostring) + "ms" else "" end)"'
    echo ""
    healthy=$(echo "$body" | jq -r '.healthy')
    total=$(echo "$body" | jq -r '.total')
    echo "Health: $healthy/$total services operational"
  else
    echo "$body"
  fi
else
  echo "AI Status API is not available (port 3002)."
  echo "HTTP Status: $http_code"
  exit 1
fi
