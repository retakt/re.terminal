#!/bin/bash
# Logging Utilities

export LOG_LEVEL_DEBUG=0
export LOG_LEVEL_INFO=1
export LOG_LEVEL_WARN=2
export LOG_LEVEL_ERROR=3

export CURRENT_LOG_LEVEL=${CURRENT_LOG_LEVEL:-$LOG_LEVEL_INFO}
export LOG_FILE="${LOG_FILE:-}"

_log() {
  local level="$1"
  local level_num="$2"
  local color="$3"
  shift 3
  local message="$*"

  if [ "$level_num" -lt "$CURRENT_LOG_LEVEL" ]; then return; fi

  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  local log_line="[$timestamp] [$level] $message"

  echo -e "${color}${log_line}\033[0m"

  if [ -n "$LOG_FILE" ]; then
    echo "$log_line" >> "$LOG_FILE"
  fi
}

log_debug()   { _log "DEBUG"   "$LOG_LEVEL_DEBUG" "\033[0;36m" "$@"; }
log_info()    { _log "INFO"    "$LOG_LEVEL_INFO"  "\033[0;37m" "$@"; }
log_warn()    { _log "WARN"    "$LOG_LEVEL_WARN"  "\033[1;33m" "$@"; }
log_error()   { _log "ERROR"   "$LOG_LEVEL_ERROR" "\033[1;31m" "$@"; }
log_success() { _log "SUCCESS" "$LOG_LEVEL_INFO"  "\033[1;32m" "$@"; }
