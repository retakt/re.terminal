#!/usr/bin/env bash

set -euo pipefail

# deploy.sh - Build locally, package the app, and deploy to VPS.
# Usage: ./deploy.sh [user] [host] [target_path] [public_url]

VPS_USER="${1:-root}"
VPS_HOST="${2:-157.173.127.84}"
VPS_PATH="${3:-/opt/re-term}"
PUBLIC_URL="${4:-https://tmux.retakt.cc}"
LIGHTPANDA_CDP_URL="${LIGHTPANDA_CDP_URL:-ws://127.0.0.1:9222}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_DIR="$(mktemp -d)"
PACKAGE_DIR="$STAGING_DIR/package"
ARCHIVE_PATH="$STAGING_DIR/re-term-deploy.tar.gz"
REMOTE_ARCHIVE="/tmp/re-term-deploy.tar.gz"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

case "$VPS_PATH" in
  ""|"/")
    echo "Error: refusing to deploy to an empty or root path"
    exit 1
    ;;
esac

cd "$SCRIPT_DIR"

if [ ! -f "package.json" ]; then
  echo "Error: run this script from the re.Term repository"
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync is required but was not found"
  exit 1
fi

echo "=== re.Term VPS Deployment Script ==="
echo "Target: ${VPS_USER}@${VPS_HOST}:${VPS_PATH}"
echo "Public URL: ${PUBLIC_URL}"
echo ""

echo "Cleaning old local builds and temp files..."
rm -rf \
  client/dist \
  client/.vite \
  client/.cache \
  client/.temp \
  server/dist \
  server/build \
  server/.cache \
  server/.temp \
  server/tmp \
  server/temp \
  server/coverage \
  dist \
  build \
  .cache \
  .temp \
  tmp \
  temp \
  coverage

find "$SCRIPT_DIR" -type f \( \
  -name "*.log" -o \
  -name "*.tmp" -o \
  -name "*.map" \
\) -delete || true

echo "Building client locally..."
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" npm run build

echo "Preparing deployment package..."
mkdir -p "$PACKAGE_DIR"

copy_if_exists() {
  local source="$1"
  local target="$2"

  if [ -e "$source" ]; then
    mkdir -p "$(dirname "$target")"
    cp -a "$source" "$target"
  fi
}

copy_if_exists "$SCRIPT_DIR/package.json" "$PACKAGE_DIR/package.json"
copy_if_exists "$SCRIPT_DIR/package-lock.json" "$PACKAGE_DIR/package-lock.json"
copy_if_exists "$SCRIPT_DIR/Caddyfile" "$PACKAGE_DIR/Caddyfile"
copy_if_exists "$SCRIPT_DIR/re-term.service" "$PACKAGE_DIR/re-term.service"
copy_if_exists "$SCRIPT_DIR/README.md" "$PACKAGE_DIR/README.md"
copy_if_exists "$SCRIPT_DIR/deploy.sh" "$PACKAGE_DIR/deploy.sh"

mkdir -p "$PACKAGE_DIR/client"
copy_if_exists "$SCRIPT_DIR/client/dist" "$PACKAGE_DIR/client/dist"

mkdir -p "$PACKAGE_DIR/server"
copy_if_exists "$SCRIPT_DIR/server/package.json" "$PACKAGE_DIR/server/package.json"
copy_if_exists "$SCRIPT_DIR/server/package-lock.json" "$PACKAGE_DIR/server/package-lock.json"
copy_if_exists "$SCRIPT_DIR/server/server.js" "$PACKAGE_DIR/server/server.js"
copy_if_exists "$SCRIPT_DIR/server/lib" "$PACKAGE_DIR/server/lib"
copy_if_exists "$SCRIPT_DIR/server/config" "$PACKAGE_DIR/server/config"
copy_if_exists "$SCRIPT_DIR/server/scripts" "$PACKAGE_DIR/server/scripts"
copy_if_exists "$SCRIPT_DIR/server/.env.example" "$PACKAGE_DIR/server/.env.example"

mkdir -p "$PACKAGE_DIR/graphiti"
copy_if_exists "$SCRIPT_DIR/graphiti/docker-compose.yml" "$PACKAGE_DIR/graphiti/docker-compose.yml"
copy_if_exists "$SCRIPT_DIR/graphiti/.env.example" "$PACKAGE_DIR/graphiti/.env.example"
copy_if_exists "$SCRIPT_DIR/graphiti/scripts" "$PACKAGE_DIR/graphiti/scripts"
copy_if_exists "$SCRIPT_DIR/graphiti/README.md" "$PACKAGE_DIR/graphiti/README.md"

if [ ! -d "$PACKAGE_DIR/client/dist" ]; then
  echo "Error: client build output was not found at client/dist"
  exit 1
fi

echo "Checking env files included in package..."
for env_file in ".env" ".env.local" "server/.env" "server/.env.local" "client/.env" "client/.env.local"; do
  if [ -f "$PACKAGE_DIR/$env_file" ]; then
    echo "  included: $env_file"
  fi
done

tar -C "$PACKAGE_DIR" -czf "$ARCHIVE_PATH" .

echo "Archive size:"
du -h "$ARCHIVE_PATH" 2>/dev/null || ls -lh "$ARCHIVE_PATH"

echo "Copying package to VPS with rsync..."
rsync -avzP \
  -e "ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=10" \
  "$ARCHIVE_PATH" \
  "${VPS_USER}@${VPS_HOST}:${REMOTE_ARCHIVE}"

echo "Deploying on VPS..."
ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=10 "${VPS_USER}@${VPS_HOST}" \
  "VPS_PATH='$VPS_PATH' VPS_HOST='$VPS_HOST' PUBLIC_URL='$PUBLIC_URL' REMOTE_ARCHIVE='$REMOTE_ARCHIVE' LIGHTPANDA_CDP_URL='$LIGHTPANDA_CDP_URL' bash -s" <<'EOF'
set -euo pipefail

mkdir -p "$VPS_PATH"

BACKUP_DIR="$(mktemp -d)"

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
    echo "Restored old env because package did not include: $target"
  fi
}

echo "Backing up env files..."
backup_file "$VPS_PATH/.env"
backup_file "$VPS_PATH/.env.local"
backup_file "$VPS_PATH/server/.env"
backup_file "$VPS_PATH/server/.env.local"
backup_file "$VPS_PATH/client/.env"
backup_file "$VPS_PATH/client/.env.local"

echo "Stopping old app if running..."
pm2 stop re-term >/dev/null 2>&1 || true

echo "Cleaning old remote app files..."
find "$VPS_PATH" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

echo "Extracting new release..."
tar -xzf "$REMOTE_ARCHIVE" -C "$VPS_PATH"
rm -f "$REMOTE_ARCHIVE"

echo "Restoring old env files only if new package did not include them..."
restore_if_missing "$VPS_PATH/.env" "$BACKUP_DIR/.env"
restore_if_missing "$VPS_PATH/.env.local" "$BACKUP_DIR/.env.local"
restore_if_missing "$VPS_PATH/server/.env" "$BACKUP_DIR/server/.env"
restore_if_missing "$VPS_PATH/server/.env.local" "$BACKUP_DIR/server/.env.local"
restore_if_missing "$VPS_PATH/client/.env" "$BACKUP_DIR/client/.env"
restore_if_missing "$VPS_PATH/client/.env.local" "$BACKUP_DIR/client/.env.local"

rm -rf "$BACKUP_DIR"

cd "$VPS_PATH"

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

install_lightpanda() {
  local target="/usr/local/bin/lightpanda"
  local arch
  local url

  arch="$(uname -m)"

  case "$arch" in
    x86_64|amd64)
      url="https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux"
      ;;
    aarch64|arm64)
      url="https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-linux"
      ;;
    *)
      echo "Warning: unsupported Lightpanda arch '$arch'; skipping Lightpanda install"
      return 0
      ;;
  esac

  if ! command -v curl >/dev/null 2>&1; then
    echo "Warning: curl not found; skipping Lightpanda install"
    return 0
  fi

  if ! command -v lightpanda >/dev/null 2>&1; then
    echo "Installing Lightpanda nightly for $arch..."
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

install_lightpanda

set_env_if_missing "$VPS_PATH/server/.env" "LIGHTPANDA_CDP_URL" "$LIGHTPANDA_CDP_URL"
set_env_if_missing "$VPS_PATH/server/.env" "MEMORY_ENABLED" "true"
set_env_if_missing "$VPS_PATH/server/.env" "MEMORY_PROVIDER" "falkordb"
set_env_if_missing "$VPS_PATH/server/.env" "MEMORY_FALLBACK_ENABLED" "true"
set_env_if_missing "$VPS_PATH/server/.env" "FALKORDB_HOST" "127.0.0.1"
set_env_if_missing "$VPS_PATH/server/.env" "FALKORDB_PORT" "6380"
set_env_if_missing "$VPS_PATH/server/.env" "FALKORDB_DATABASE" "graphiti_memory"
set_env_if_missing "$VPS_PATH/server/.env" "SEARXNG_URL" "https://search-api.retakt.cc"

if [ -d "$VPS_PATH/graphiti" ] && command -v docker >/dev/null 2>&1; then
  echo "Starting FalkorDB memory sidecar..."
  if [ -f "$VPS_PATH/graphiti/.env.example" ] && [ ! -f "$VPS_PATH/graphiti/.env" ]; then
    cp "$VPS_PATH/graphiti/.env.example" "$VPS_PATH/graphiti/.env"
  fi
  (cd "$VPS_PATH/graphiti" && docker compose up -d falkordb) || echo "Warning: failed to start FalkorDB sidecar"
fi

echo "Installing server dependencies..."
npm ci --prefix server --omit=dev

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "Starting app with PM2..."
if pm2 describe re-term >/dev/null 2>&1; then
  pm2 restart re-term --update-env
else
  pm2 start server/server.js --name re-term --update-env
fi

echo "Checking local server endpoints on VPS..."

wait_for_endpoint() {
  local url="$1"
  local attempts="${2:-30}"

  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    echo "Warning: curl/wget not found; skipping endpoint smoke checks"
    return 0
  fi

  for attempt in $(seq 1 "$attempts"); do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS --max-time 2 "$url" >/dev/null; then
        echo "OK: $url"
        return 0
      fi
    elif wget -qO- --timeout=2 "$url" >/dev/null; then
      echo "OK: $url"
      return 0
    fi

    echo "Waiting for $url ($attempt/$attempts)..."
    sleep 1
  done

  echo "Error: endpoint did not become ready: $url"
  pm2 logs re-term --lines 80 --nostream || true
  return 1
}

wait_for_endpoint "http://127.0.0.1:3003/health" 30
wait_for_endpoint "http://127.0.0.1:3003/api/files?path=/" 30
wait_for_endpoint "http://127.0.0.1:3003/api/browser/status" 30
wait_for_endpoint "http://127.0.0.1:3003/api/services/status" 30

if command -v curl >/dev/null 2>&1; then
  echo "Browser status:"
  curl -fsS --max-time 5 "http://127.0.0.1:3003/api/browser/status" || true
  echo ""
fi

pm2 save

echo "Cleaning remote temp junk..."
rm -f "$REMOTE_ARCHIVE"

echo "Deployment complete."
echo "Access: ${PUBLIC_URL}"
EOF

echo ""
echo "=== Deployment Complete ==="
echo "Built locally and deployed to ${VPS_USER}@${VPS_HOST}:${VPS_PATH}"
echo "Access: ${PUBLIC_URL}"
