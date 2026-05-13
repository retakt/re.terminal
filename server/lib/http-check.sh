#!/bin/bash
# HTTP Health Check Utilities

http_check() {
  local name="$1"
  local url="$2"
  local timeout="${3:-5}"

  local start_time=$(date +%s%3N)
  local http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$timeout" "$url" 2>/dev/null)
  local curl_exit=$?
  local end_time=$(date +%s%3N)
  local response_time=$((end_time - start_time))

  export HTTP_CHECK_CODE="$http_code"
  export HTTP_CHECK_TIME="$response_time"
  export HTTP_CHECK_EXIT="$curl_exit"

  if [ $curl_exit -eq 0 ] && [ "$http_code" = "200" ]; then
    return 0
  else
    return 1
  fi
}

http_check_print() {
  local name="$1"
  local url="$2"
  local timeout="${3:-5}"

  if http_check "$name" "$url" "$timeout"; then
    if [ "$HTTP_CHECK_TIME" -lt 1000 ]; then
      printf "  ● %-25s \033[1;32mREADY\033[0m   %5dms  HTTP %s\n" "$name" "$HTTP_CHECK_TIME" "$HTTP_CHECK_CODE"
    else
      printf "  ● %-25s \033[1;33mSLOW\033[0m    %5dms  HTTP %s\n" "$name" "$HTTP_CHECK_TIME" "$HTTP_CHECK_CODE"
    fi
  else
    if [ "$HTTP_CHECK_CODE" != "000" ] && [ "$HTTP_CHECK_EXIT" -eq 0 ]; then
      printf "  ● %-25s \033[1;33mWARN\033[0m    %5dms  HTTP %s\n" "$name" "$HTTP_CHECK_TIME" "$HTTP_CHECK_CODE"
    else
      printf "  ● %-25s \033[1;31mDOWN\033[0m    timeout  Connection Failed\n" "$name"
    fi
  fi
}
