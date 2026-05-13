#!/bin/bash
# deploy.sh - Quick deployment script for re.Term to VPS
# Usage: ./deploy.sh root@157.173.127.84

VPS_USER=${1:-root}
VPS_HOST=${2:-157.173.127.84}
VPS_PATH=${3:-/opt/re-term}

echo "=== re.Term VPS Deployment Script ==="
echo "Target: ${VPS_USER}@${VPS_HOST}:${VPS_PATH}"
echo ""

# Check if running from re.Term directory
if [ ! -f "package.json" ]; then
    echo "Error: Run this script from the re.Term directory"
    exit 1
fi

# Build client
echo "Building client..."
npm run build
if [ $? -ne 0 ]; then
    echo "Build failed!"
    exit 1
fi

# Create deployment archive
echo "Creating deployment package..."
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='dist' \
    --exclude='build' \
    --exclude='*.log' \
    -czf /tmp/re-term-deploy.tar.gz \
    package.json package-lock.json \
    server/ client/ \


# Copy to VPS
echo "Copying to VPS..."
scp /tmp/re-term-deploy.tar.gz ${VPS_USER}@${VPS_HOST}:/tmp/

# SSH and setup on VPS
echo "Setting up on VPS..."
ssh ${VPS_USER}@${VPS_HOST} << 'EOF'
    set -e
    cd /tmp
    tar -xzf re-term-deploy.tar.gz
    
    # Create deployment directory
    mkdir -p /opt/re-term
    cd /opt/re-term
    
    # Move files
    mv /tmp/package.json /tmp/package-lock.json ./
    mv /tmp/server ./ 2>/dev/null || true
    mv /tmp/client ./ 2>/dev/null || true
    
    # Install dependencies
    npm install
    cd client && npm install && cd ..
    cd server && npm install && cd ..
    
    # Build client
    npm run build
    
    # Create .env if not exists
    if [ ! -f server/.env ]; then
        cp server/.env.example server/.env
        echo "Created server/.env - please edit with your settings"
    fi
    
    # Install PM2 if not exists
    if ! command -v pm2 &> /dev/null; then
        npm install -g pm2
    fi
    
    # Start with PM2
    pm2 start server/server.js --name re-term
    pm2 save
    
    echo "Deployment complete!"
    echo "Access your terminal at: http://$(hostname):3003"
EOF

# Cleanup
rm -f /tmp/re-term-deploy.tar.gz

echo ""
echo "=== Deployment Complete ==="
echo "Access: http://${VPS_HOST}:3003"
echo "Password: itsretakt"
