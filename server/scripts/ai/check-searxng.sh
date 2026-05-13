#!/bin/bash
# Check SearXNG Web Search Service

echo "Checking SearXNG Web Search Service..."
echo ""

start_time=$(date +%s%3N)
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://search-api.retakt.cc/search?q=test&format=json" 2>/dev/null)
curl_exit=$?
end_time=$(date +%s%3N)
response_time=$((end_time - start_time))

if [ $curl_exit -eq 0 ] && [ "$http_code" = "200" ]; then
  echo "✅ SearXNG is OPERATIONAL"
  echo "   Response Time: ${response_time}ms"
  echo "   HTTP Status: $http_code"

  search_result=$(curl -s --max-time 3 "https://search-api.retakt.cc/search?q=test&format=json" 2>/dev/null)
  if command -v jq >/dev/null 2>&1; then
    result_count=$(echo "$search_result" | jq -r '.results | length' 2>/dev/null)
    [ -n "$result_count" ] && [ "$result_count" != "null" ] && echo "   Test Search: $result_count results"
  fi
else
  echo "🔴 SearXNG is DOWN"
  echo "   HTTP Status: $http_code"
  exit 1
fi
