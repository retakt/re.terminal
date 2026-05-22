#!/usr/bin/env bash

set -euo pipefail

# deploy.sh - Build on VPS, install only production-ready files.
# Usage: ./deploy.sh [user] [host] [target_path] [public_url]

VPS_USER="${1:-root}"
VPS_HOST="${2:-157.173.127.84}"
VPS_PATH="${3:-/opt/re-term}"
PUBLIC_URL="${4:-https://tmux.retakt.cc}"

LIGHTPANDA_CDP_URL="${LIGHTPANDA_CDP_URL:-ws://127.0.0.1:9222}"
BROWSER_CHROME_CDP_PORT="${BROWSER_CHROME_CDP_PORT:-9223}"
BROWSER_CHROME_CDP_URL="${BROWSER_CHROME_CDP_URL:-ws://127.0.0.1:${BROWSER_CHROME_CDP_PORT}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_TMP="$(mktemp -d)"
SOURCE_ARCHIVE="$LOCAL_TMP/re-term-source.tar.gz"
REMOTE_SOURCE_ARCHIVE="/tmp/re-term-source.tar.gz"

cleanup_local() {
  rm -rf "$LOCAL_TMP"
}
trap cleanup_local EXIT

case "$VPS_PATH" in
  ""|"/")
    echo "Error: refusing to deploy to empty/root path"
    exit 1
    ;;
esac

cd "$SCRIPT_DIR"

if [ ! -f package.json ] || [ ! -d client ] || [ ! -d server ]; then
  echo "Error: run this from the re.Term repo root"
  exit 1
fi

if command -v rsync >/dev/null 2>&1; then
  TRANSFER_TOOL="rsync"
elif command -v scp >/dev/null 2>&1; then
  TRANSFER_TOOL="scp"
else
  echo "Error: rsync or scp required"
  exit 1
fi

echo "=== re.Term production deploy ==="
echo "Target: ${VPS_USER}@${VPS_HOST}:${VPS_PATH}"
echo "Public URL: ${PUBLIC_URL}"
echo ""

echo "Creating clean source archive for VPS build..."

tar -czf "$SOURCE_ARCHIVE" \
  --exclude=".git" \
  --exclude=".github" \
  --exclude=".vscode" \
  --exclude="node_modules" \
  --exclude="*/node_modules" \
  --exclude="client/dist" \
  --exclude="client/.vite" \
  --exclude="client/.cache" \
  --exclude="client/.temp" \
  --exclude="server/dist" \
  --exclude="server/build" \
  --exclude="server/.cache" \
  --exclude="server/.temp" \
  --exclude="server/tmp" \
  --exclude="server/temp" \
  --exclude="server/coverage" \
  --exclude="server/.playwright-mcp" \
  --exclude="dist" \
  --exclude="build" \
  --exclude=".cache" \
  --exclude=".temp" \
  --exclude="tmp" \
  --exclude="temp" \
  --exclude="coverage" \
  --exclude="*.log" \
  --exclude="*.tmp" \
  --exclude="*.map" \
  --exclude=".env" \
  --exclude=".env.local" \
  --exclude=".env.*" \
  --exclude="client/.env" \
  --exclude="client/.env.local" \
  --exclude="server/.env" \
  --exclude="server/.env.local" \
  --exclude="server/.env.*" \
  --exclude="server/scripts/smoke-*" \
  --exclude="server/scripts/test-*" \
  --exclude="server/test-*" \
  --exclude="server/*.test.*" \
  --exclude="server/*.spec.*" \
  -C "$SCRIPT_DIR" .

echo "Source archive size:"
du -h "$SOURCE_ARCHIVE" 2>/dev/null || ls -lh "$SOURCE_ARCHIVE"

echo "Uploading source archive..."
if [ "$TRANSFER_TOOL" = "rsync" ]; then
  rsync -avzP -e "ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=10" \
    "$SOURCE_ARCHIVE" "${VPS_USER}@${VPS_HOST}:${REMOTE_SOURCE_ARCHIVE}"
else
  scp -o ServerAliveInterval=30 -o ServerAliveCountMax=10 \
    "$SOURCE_ARCHIVE" "${VPS_USER}@${VPS_HOST}:${REMOTE_SOURCE_ARCHIVE}"
fi

echo "Building and deploying on VPS..."
ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=10 "${VPS_USER}@${VPS_HOST}" \
  "VPS_PATH='$VPS_PATH' PUBLIC_URL='$PUBLIC_URL' REMOTE_SOURCE_ARCHIVE='$REMOTE_SOURCE_ARCHIVE' LIGHTPANDA_CDP_URL='$LIGHTPANDA_CDP_URL' BROWSER_CHROME_CDP_URL='$BROWSER_CHROME_CDP_URL' BROWSER_CHROME_CDP_PORT='$BROWSER_CHROME_CDP_PORT' bash -s" <<'REMOTE'
set -euo pipefail

BUILD_ROOT="$(mktemp -d /tmp/re-term-build.XXXXXX)"
SOURCE_DIR="$BUILD_ROOT/source"
RELEASE_DIR="$BUILD_ROOT/release"
BACKUP_DIR="$(mktemp -d /tmp/re-term-env-backup.XXXXXX)"

cleanup_remote() {
  rm -rf "$BUILD_ROOT" "$BACKUP_DIR" "$REMOTE_SOURCE_ARCHIVE"
}
trap cleanup_remote EXIT

copy_if_exists() {
  local source="$1"
  local target="$2"
  if [ -e "$source" ]; then
    mkdir -p "$(dirname "$target")"
    cp -a "$source" "$target"
  fi
}

backup_file() {
  local source="$1"
  if [ -f "$source" ]; then
    local relative="${source#$VPS_PATH/}"
    mkdir -p "$BACKUP_DIR/$(dirname "$relative")"
    cp -a "$source" "$BACKUP_DIR/$relative"
  fi
}

restore_if_missing() {
  local target="$1"
  local backup="$2"
  if [ ! -f "$target" ] && [ -f "$backup" ]; then
    mkdir -p "$(dirname "$target")"
    cp -a "$backup" "$target"
    echo "Restored env: $target"
  fi
}

prune_non_production() {
  local root="$1"
  [ -d "$root" ] || return 0

  find "$root" -type d \( \
    -name node_modules -o \
    -name .git -o \
    -name .github -o \
    -name .vscode -o \
    -name dist -o \
    -name build -o \
    -name coverage -o \
    -name .cache -o \
    -name .temp -o \
    -name tmp -o \
    -name temp -o \
    -name __tests__ -o \
    -name test -o \
    -name tests -o \
    -name .playwright-mcp \
  \) -prune -exec rm -rf {} + 2>/dev/null || true

  find "$root" -type f \( \
    -name "*.log" -o \
    -name "*.tmp" -o \
    -name "*.map" -o \
    -name ".env" -o \
    -name ".env.local" -o \
    -name ".env.*" -o \
    -name "*.test.*" -o \
    -name "*.spec.*" -o \
    -name "test-*" -o \
    -name "smoke-*" \
  \) ! -name ".env.example" -delete || true
}

set_env_if_missing() {
  local file="$1"
  local key="$2"
  local value="$3"

  mkdir -p "$(dirname "$file")"
  touch "$file"

  if grep -q "^${key}=" "$file"; then
    return 0
  fi

  printf "\n%s=%s\n" "$key" "$value" >> "$file"
}

set_env_if_missing_or_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local old_value="$4"

  mkdir -p "$(dirname "$file")"
  touch "$file"

  if grep -q "^${key}=${old_value}$" "$file"; then
    sed -i "s|^${key}=.*$|${key}=${value}|" "$file"
    return 0
  fi

  set_env_if_missing "$file" "$key" "$value"
}

wait_for_endpoint() {
  local url="$1"
  local attempts="${2:-30}"

  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    echo "Warning: curl/wget missing; skipping endpoint check"
    return 0
  fi

  for attempt in $(seq 1 "$attempts"); do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS --max-time 3 "$url" >/dev/null; then
        echo "OK: $url"
        return 0
      fi
    elif wget -qO- --timeout=3 "$url" >/dev/null; then
      echo "OK: $url"
      return 0
    fi

    echo "Waiting for $url ($attempt/$attempts)..."
    sleep 1
  done

  echo "Error: endpoint did not become ready: $url"
  pm2 logs re-term --lines 100 --nostream || true
  return 1
}

install_lightpanda() {
  local target="/usr/local/bin/lightpanda"
  local arch
  local url

  arch="$(uname -m)"

  case "$arch" in
    x86_64|amd64) url="https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux" ;;
    aarch64|arm64) url="https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-linux" ;;
    *)
      echo "Warning: unsupported Lightpanda arch '$arch'; skipping"
      return 0
      ;;
  esac

  if ! command -v curl >/dev/null 2>&1; then
    echo "Warning: curl missing; skipping Lightpanda"
    return 0
  fi

  if ! command -v lightpanda >/dev/null 2>&1; then
    echo "Installing Lightpanda..."
    curl -fL -o "$target" "$url"
    chmod 0755 "$target"
  fi

  if command -v systemctl >/dev/null 2>&1; then
    cat >/etc/systemd/system/lightpanda.service <<SYSTEMD
[Unit]
Description=Lightpanda CDP browser for re.Term
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=LIGHTPANDA_DISABLE_TELEMETRY=true
ExecStart=$target serve --host 127.0.0.1 --port 9222 --log-level warn
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SYSTEMD
    systemctl daemon-reload
    systemctl enable --now lightpanda
    systemctl restart lightpanda
  else
    if ! pgrep -f "lightpanda serve" >/dev/null 2>&1; then
      nohup "$target" serve --host 127.0.0.1 --port 9222 --log-level warn >/var/log/lightpanda-reterm.log 2>&1 &
    fi
  fi
}

install_chrome() {
  if command -v google-chrome >/dev/null 2>&1 || command -v google-chrome-stable >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v apt-get >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    echo "Warning: apt-get/curl missing; skipping Chrome"
    return 0
  fi

  echo "Installing Google Chrome stable..."
  apt-get update || true
  apt-get install -y ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 libnss3 libxcomposite1 libxdamage1 libxrandr2 xdg-utils wget gnupg || true
  rm -f /usr/share/keyrings/google-linux-signing-keyring.gpg
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /usr/share/keyrings/google-linux-signing-keyring.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux-signing-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" >/etc/apt/sources.list.d/google-chrome.list
  apt-get update || true
  apt-get install -y google-chrome-stable || true
}

install_playwright() {
  echo "Checking Playwright MCP/browser setup..."

  if ! command -v npm >/dev/null 2>&1; then
    echo "Warning: npm missing; skipping Playwright"
    return 0
  fi

  npx -y @playwright/mcp@latest --version >/dev/null 2>&1 || true

  if ! (cd "$VPS_PATH/server" && node -e "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1); then
    npm install --prefix "$VPS_PATH/server" --omit=dev playwright
  fi

  if [ -x "$VPS_PATH/server/node_modules/.bin/playwright" ]; then
    npx --prefix "$VPS_PATH/server" playwright install --with-deps chromium \
      || npx --prefix "$VPS_PATH/server" playwright install chromium \
      || echo "Warning: Playwright browser install failed"
  fi
}

echo "Extracting source to temporary build folder..."
mkdir -p "$SOURCE_DIR" "$RELEASE_DIR"
tar -xzf "$REMOTE_SOURCE_ARCHIVE" -C "$SOURCE_DIR"

cd "$SOURCE_DIR"

if [ ! -f package.json ] || [ ! -d client ] || [ ! -d server ]; then
  echo "Error: source archive is invalid"
  exit 1
fi

echo "Installing root/client dependencies for VPS build..."
npm ci
npm ci --prefix client

echo "Building client on VPS..."
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}" npm --prefix client run build

echo "Preparing clean production release..."
copy_if_exists "$SOURCE_DIR/package.json" "$RELEASE_DIR/package.json"
copy_if_exists "$SOURCE_DIR/package-lock.json" "$RELEASE_DIR/package-lock.json"
copy_if_exists "$SOURCE_DIR/Caddyfile" "$RELEASE_DIR/Caddyfile"
copy_if_exists "$SOURCE_DIR/re-term.service" "$RELEASE_DIR/re-term.service"
copy_if_exists "$SOURCE_DIR/README.md" "$RELEASE_DIR/README.md"
copy_if_exists "$SOURCE_DIR/deploy.sh" "$RELEASE_DIR/deploy.sh"
copy_if_exists "$SOURCE_DIR/scripts" "$RELEASE_DIR/scripts"

mkdir -p "$RELEASE_DIR/client"
copy_if_exists "$SOURCE_DIR/client/dist" "$RELEASE_DIR/client/dist"

copy_if_exists "$SOURCE_DIR/server" "$RELEASE_DIR/server"
prune_non_production "$RELEASE_DIR/server"

mkdir -p "$RELEASE_DIR/graphiti"
copy_if_exists "$SOURCE_DIR/graphiti/docker-compose.yml" "$RELEASE_DIR/graphiti/docker-compose.yml"
copy_if_exists "$SOURCE_DIR/graphiti/.env.example" "$RELEASE_DIR/graphiti/.env.example"
copy_if_exists "$SOURCE_DIR/graphiti/scripts" "$RELEASE_DIR/graphiti/scripts"
copy_if_exists "$SOURCE_DIR/graphiti/README.md" "$RELEASE_DIR/graphiti/README.md"
prune_non_production "$RELEASE_DIR/graphiti"
prune_non_production "$RELEASE_DIR/scripts"

echo "Validating production release..."
for required in \
  "$RELEASE_DIR/client/dist" \
  "$RELEASE_DIR/server/server.js" \
  "$RELEASE_DIR/server/package.json" \
  "$RELEASE_DIR/server/lib/memory-client.js" \
  "$RELEASE_DIR/server/lib/mcp-gateway.js" \
  "$RELEASE_DIR/server/config/mcp-servers.json"
do
  if [ ! -e "$required" ]; then
    echo "Error: required production file missing: $required"
    exit 1
  fi
done

if find "$RELEASE_DIR" -type f \( \
  -name "smoke-*" -o \
  -name "test-*" -o \
  -name "*.test.*" -o \
  -name "*.spec.*" -o \
  -path "*/__tests__/*" -o \
  -path "*/tests/*" -o \
  -path "*/test/*" \
\) | grep -q .; then
  echo "Error: release contains smoke/test files:"
  find "$RELEASE_DIR" -type f \( \
    -name "smoke-*" -o \
    -name "test-*" -o \
    -name "*.test.*" -o \
    -name "*.spec.*" -o \
    -path "*/__tests__/*" -o \
    -path "*/tests/*" -o \
    -path "*/test/*" \
  \)
  exit 1
fi

if find "$RELEASE_DIR" -type f \( \
  -name ".env" -o \
  -name ".env.local" -o \
  -name ".env.*" \
\) ! -name ".env.example" | grep -q .; then
  echo "Error: release contains secret env files:"
  find "$RELEASE_DIR" -type f \( \
    -name ".env" -o \
    -name ".env.local" -o \
    -name ".env.*" \
  \) ! -name ".env.example"
  exit 1
fi

echo "Release size:"
du -sh "$RELEASE_DIR"

echo "Backing up existing env files..."
mkdir -p "$VPS_PATH"
backup_file "$VPS_PATH/.env"
backup_file "$VPS_PATH/.env.local"
backup_file "$VPS_PATH/server/.env"
backup_file "$VPS_PATH/server/.env.local"
backup_file "$VPS_PATH/client/.env"
backup_file "$VPS_PATH/client/.env.local"

echo "Stopping app..."
pm2 stop re-term >/dev/null 2>&1 || true

echo "Replacing app with clean production release..."
find "$VPS_PATH" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$RELEASE_DIR/." "$VPS_PATH/"

echo "Restoring env files..."
restore_if_missing "$VPS_PATH/.env" "$BACKUP_DIR/.env"
restore_if_missing "$VPS_PATH/.env.local" "$BACKUP_DIR/.env.local"
restore_if_missing "$VPS_PATH/server/.env" "$BACKUP_DIR/server/.env"
restore_if_missing "$VPS_PATH/server/.env.local" "$BACKUP_DIR/server/.env.local"
restore_if_missing "$VPS_PATH/client/.env" "$BACKUP_DIR/client/.env"
restore_if_missing "$VPS_PATH/client/.env.local" "$BACKUP_DIR/client/.env.local"

cd "$VPS_PATH"

echo "Writing safe default server env values..."
set_env_if_missing "$VPS_PATH/server/.env" "LIGHTPANDA_CDP_URL" "$LIGHTPANDA_CDP_URL"
set_env_if_missing "$VPS_PATH/server/.env" "BROWSER_CHROME_CDP_URL" "$BROWSER_CHROME_CDP_URL"
set_env_if_missing "$VPS_PATH/server/.env" "BROWSER_CHROME_CDP_PORT" "$BROWSER_CHROME_CDP_PORT"
set_env_if_missing_or_value "$VPS_PATH/server/.env" "BROWSER_AGENT_ENGINE_PRIORITY" "lightpanda_cdp,chrome_cdp,static_fetch" "lightpanda_cdp,static_fetch"
set_env_if_missing "$VPS_PATH/server/.env" "BROWSER_CHROME_FALLBACK_ENABLED" "false"
set_env_if_missing "$VPS_PATH/server/.env" "LIGHTPANDA_NATIVE_MCP_ENABLED" "false"
set_env_if_missing "$VPS_PATH/server/.env" "BROWSER_PAGE_SETTLE_MS" "45000"
set_env_if_missing "$VPS_PATH/server/.env" "BROWSER_AFTER_ACTION_SETTLE_MS" "12000"
set_env_if_missing "$VPS_PATH/server/.env" "MEMORY_ENABLED" "true"
set_env_if_missing "$VPS_PATH/server/.env" "MEMORY_PROVIDER" "falkordb"
set_env_if_missing "$VPS_PATH/server/.env" "MEMORY_FALLBACK_ENABLED" "true"
set_env_if_missing "$VPS_PATH/server/.env" "FALKORDB_HOST" "127.0.0.1"
set_env_if_missing "$VPS_PATH/server/.env" "FALKORDB_PORT" "6380"
set_env_if_missing "$VPS_PATH/server/.env" "FALKORDB_DATABASE" "graphiti_memory"
set_env_if_missing "$VPS_PATH/server/.env" "SEARXNG_URL" "https://search-api.retakt.cc"

echo "Installing production server dependencies..."
npm ci --prefix server --omit=dev

install_lightpanda
install_chrome
install_playwright

if [ -d "$VPS_PATH/graphiti" ] && command -v docker >/dev/null 2>&1; then
  echo "Starting FalkorDB memory sidecar..."
  if [ -f "$VPS_PATH/graphiti/.env.example" ] && [ ! -f "$VPS_PATH/graphiti/.env" ]; then
    cp "$VPS_PATH/graphiti/.env.example" "$VPS_PATH/graphiti/.env"
  fi
  (cd "$VPS_PATH/graphiti" && docker compose up -d falkordb) || echo "Warning: failed to start FalkorDB"
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "Starting app with PM2..."
if pm2 describe re-term >/dev/null 2>&1; then
  pm2 restart re-term --update-env
else
  pm2 start server/server.js --name re-term --update-env
fi

echo "Checking local server endpoints..."
wait_for_endpoint "http://127.0.0.1:3003/api/stats" 30
wait_for_endpoint "http://127.0.0.1:3003/api/files?path=/" 30
wait_for_endpoint "http://127.0.0.1:3003/api/browser/status" 30
wait_for_endpoint "http://127.0.0.1:3003/api/services/status" 30

pm2 save

echo "Cleaning Docker build cache lightly..."
docker builder prune -af >/dev/null 2>&1 || true

echo "Final disk usage:"
df -h /

echo "Deployment complete."
echo "Access: ${PUBLIC_URL}"
REMOTE

echo ""
echo "=== Deployment Complete ==="
echo "Built on VPS and deployed production files to ${VPS_USER}@${VPS_HOST}:${VPS_PATH}"
echo "Access: ${PUBLIC_URL}"
