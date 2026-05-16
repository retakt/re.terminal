#!/usr/bin/env bash

set -euo pipefail

# deploy.sh - Build locally, package the full app, and deploy to a VPS.
# Usage: ./deploy.sh [user] [host] [target_path] [public_url]

VPS_USER="${1:-root}"
VPS_HOST="${2:-157.173.127.84}"
VPS_PATH="${3:-/opt/re-term}"
PUBLIC_URL="${4:-https://tmux.retakt.cc}"

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

echo "=== re.Term VPS Deployment Script ==="
echo "Target: ${VPS_USER}@${VPS_HOST}:${VPS_PATH}"
echo "Public URL: ${PUBLIC_URL}"
echo ""

echo "Building client locally..."
npm run build

echo "Preparing deployment package..."
mkdir -p "$PACKAGE_DIR"

tar -C "$SCRIPT_DIR" \
  --exclude=".git" \
  --exclude="node_modules" \
  --exclude="client/node_modules" \
  --exclude="server/node_modules" \
  --exclude="*.log" \
  --exclude="*.tmp" \
  -cf - . | tar -C "$PACKAGE_DIR" -xf -

if [ ! -d "$PACKAGE_DIR/client/dist" ]; then
  echo "Error: client build output was not found at client/dist"
  exit 1
fi

tar -C "$PACKAGE_DIR" -czf "$ARCHIVE_PATH" .

echo "Copying package to VPS..."
scp "$ARCHIVE_PATH" "${VPS_USER}@${VPS_HOST}:${REMOTE_ARCHIVE}"

echo "Deploying on VPS..."
ssh "${VPS_USER}@${VPS_HOST}" \
  "VPS_PATH='$VPS_PATH' VPS_HOST='$VPS_HOST' PUBLIC_URL='$PUBLIC_URL' REMOTE_ARCHIVE='$REMOTE_ARCHIVE' bash -s" <<'EOF'
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

backup_file "$VPS_PATH/.env"
backup_file "$VPS_PATH/.env.local"
backup_file "$VPS_PATH/server/.env"
backup_file "$VPS_PATH/server/.env.local"

find "$VPS_PATH" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

tar -xzf "$REMOTE_ARCHIVE" -C "$VPS_PATH"
rm -f "$REMOTE_ARCHIVE"

if [ -f "$BACKUP_DIR/.env" ]; then
  cp -a "$BACKUP_DIR/.env" "$VPS_PATH/.env"
fi

if [ -f "$BACKUP_DIR/.env.local" ]; then
  cp -a "$BACKUP_DIR/.env.local" "$VPS_PATH/.env.local"
fi

if [ -f "$BACKUP_DIR/server/.env" ]; then
  mkdir -p "$VPS_PATH/server"
  cp -a "$BACKUP_DIR/server/.env" "$VPS_PATH/server/.env"
fi

if [ -f "$BACKUP_DIR/server/.env.local" ]; then
  mkdir -p "$VPS_PATH/server"
  cp -a "$BACKUP_DIR/server/.env.local" "$VPS_PATH/server/.env.local"
fi

rm -rf "$BACKUP_DIR"

cd "$VPS_PATH"

npm ci --prefix server --omit=dev

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

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
        return 0
      fi
    elif wget -qO- --timeout=2 "$url" >/dev/null; then
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

pm2 save

echo "Deployment complete."
echo "Access: ${PUBLIC_URL}"
EOF

echo ""
echo "=== Deployment Complete ==="
echo "Built locally and deployed to ${VPS_USER}@${VPS_HOST}:${VPS_PATH}"
echo "Access: ${PUBLIC_URL}"
