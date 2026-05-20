# Start Graph Visualization Server
Write-Host "🚀 Starting Memory Graph Server..." -ForegroundColor Green

# Check if Python is installed
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Host "❌ Python not found. Please install Python and ensure it's in your PATH." -ForegroundColor Red
    exit 1
}

# Check if dependencies are installed
Write-Host "📦 Checking dependencies..." -ForegroundColor Yellow
python -m pip list | Select-String "fastapi|uvicorn|falkordb"

# Install dependencies if missing
Write-Host "📦 Installing/Updating dependencies..." -ForegroundColor Yellow
python -m pip install fastapi uvicorn falkordb python-dotenv websockets

# Start the server
Write-Host "📡 Graph Server starting on ws://localhost:8765" -ForegroundColor Cyan
python graph-server.py
