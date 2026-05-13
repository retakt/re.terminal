#!/bin/bash
# Check Specific AI Tool
# Usage: specific-tool-check.sh <tool-name>

if [ -z "$1" ]; then
  echo "Usage: specific-tool-check.sh <tool-name>"
  exit 1
fi

TOOL_NAME="$1"
ENCODED_TOOL=$(echo "$TOOL_NAME" | sed 's/ /%20/g')

response=$(curl -s -w "\n%{http_code}" --max-time 5 "http://localhost:3002/status/$ENCODED_TOOL" 2>/dev/null)
http_code=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
  if command -v jq >/dev/null 2>&1; then
    name=$(echo "$body" | jq -r '.name')
    status=$(echo "$body" | jq -r '.status')
    response_time=$(echo "$body" | jq -r '.responseTime // "N/A"')
    healthy=$(echo "$body" | jq -r '.healthy')

    echo "$name: $status"
    [ "$response_time" != "N/A" ] && echo "Response Time: ${response_time}ms"
    [ "$healthy" = "true" ] && echo "Status: ✅ Operational" || echo "Status: 🔴 Down"
  else
    echo "$body"
  fi
elif [ "$http_code" = "404" ]; then
  echo "Tool \"$TOOL_NAME\" not found."
else
  echo "AI Status API is not available (port 3002)."
  echo "HTTP Status: $http_code"
  exit 1
fi
