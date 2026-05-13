#!/bin/bash
# Check Ollama AI Service

echo "Checking Ollama AI Service..."
echo ""

start_time=$(date +%s%3N)
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://chat-api.retakt.cc/api/tags" 2>/dev/null)
curl_exit=$?
end_time=$(date +%s%3N)
response_time=$((end_time - start_time))

if [ $curl_exit -eq 0 ] && [ "$http_code" = "200" ]; then
  echo "✅ Ollama is OPERATIONAL"
  echo "   Response Time: ${response_time}ms"
  echo "   HTTP Status: $http_code"

  models=$(curl -s --max-time 3 "https://chat-api.retakt.cc/api/tags" 2>/dev/null)
  if command -v jq >/dev/null 2>&1; then
    model_count=$(echo "$models" | jq -r '.models | length' 2>/dev/null)
    [ -n "$model_count" ] && [ "$model_count" != "null" ] && echo "   Available Models: $model_count"
  fi
else
  echo "🔴 Ollama is DOWN"
  echo "   HTTP Status: $http_code"
  exit 1
fi
