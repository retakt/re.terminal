#!/bin/bash
# ANSI Color Codes and Formatting Functions

export COLOR_BLACK='\033[0;30m'
export COLOR_RED='\033[0;31m'
export COLOR_GREEN='\033[0;32m'
export COLOR_YELLOW='\033[0;33m'
export COLOR_BLUE='\033[0;34m'
export COLOR_MAGENTA='\033[0;35m'
export COLOR_CYAN='\033[0;36m'
export COLOR_WHITE='\033[0;37m'

export COLOR_BOLD_BLACK='\033[1;30m'
export COLOR_BOLD_RED='\033[1;31m'
export COLOR_BOLD_GREEN='\033[1;32m'
export COLOR_BOLD_YELLOW='\033[1;33m'
export COLOR_BOLD_BLUE='\033[1;34m'
export COLOR_BOLD_MAGENTA='\033[1;35m'
export COLOR_BOLD_CYAN='\033[1;36m'
export COLOR_BOLD_WHITE='\033[1;37m'

export BG_BLACK='\033[40m'
export BG_RED='\033[41m'
export BG_GREEN='\033[42m'
export BG_YELLOW='\033[43m'
export BG_BLUE='\033[44m'
export BG_MAGENTA='\033[45m'
export BG_CYAN='\033[46m'
export BG_WHITE='\033[47m'

export FORMAT_BOLD='\033[1m'
export FORMAT_DIM='\033[2m'
export FORMAT_UNDERLINE='\033[4m'
export FORMAT_BLINK='\033[5m'
export FORMAT_REVERSE='\033[7m'
export FORMAT_HIDDEN='\033[8m'

export COLOR_RESET='\033[0m'

color_echo()    { local color="$1"; shift; echo -e "${color}$*${COLOR_RESET}"; }
color_success() { color_echo "$COLOR_BOLD_GREEN"  "✓ $*"; }
color_error()   { color_echo "$COLOR_BOLD_RED"    "✗ $*"; }
color_warning() { color_echo "$COLOR_BOLD_YELLOW" "⚠ $*"; }
color_info()    { color_echo "$COLOR_BOLD_CYAN"   "ℹ $*"; }

color_header() {
  echo ""
  color_echo "$COLOR_BOLD_WHITE" "================================================================"
  color_echo "$COLOR_BOLD_WHITE" "  $*"
  color_echo "$COLOR_BOLD_WHITE" "================================================================"
  echo ""
}

color_section() {
  echo ""
  color_echo "$COLOR_BOLD_CYAN" "--- $* ---"
  echo ""
}
