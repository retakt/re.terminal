param(
  [switch]$WithMcp
)

$ErrorActionPreference = "Stop"
$composeArgs = @("compose")

if ($WithMcp) {
  $composeArgs += @("--profile", "mcp")
}

$composeArgs += @("up", "-d")

Write-Host "Starting re.Term memory services..." -ForegroundColor Cyan
docker @composeArgs

Write-Host "Waiting for FalkorDB..." -ForegroundColor Yellow
for ($i = 1; $i -le 20; $i++) {
  $status = docker inspect --format '{{.State.Health.Status}}' reterm-falkordb 2>$null
  if ($status -eq "healthy") {
    Write-Host "FalkorDB is healthy at 127.0.0.1:6380" -ForegroundColor Green
    break
  }
  Start-Sleep -Seconds 2
}

if ($WithMcp) {
  Write-Host "Checking Graphiti MCP health..." -ForegroundColor Yellow
  try {
    $mcpStatus = (Invoke-WebRequest -Uri "http://127.0.0.1:8001/health" -UseBasicParsing -ErrorAction Stop).StatusCode
    if ($mcpStatus -eq 200) {
      Write-Host "Graphiti MCP is healthy at http://127.0.0.1:8001/mcp/" -ForegroundColor Green
    }
  } catch {
    Write-Host "Graphiti MCP is still starting. Check: docker logs -f reterm-graphiti-mcp" -ForegroundColor Yellow
  }
}

Write-Host "Node backend should use MEMORY_ENABLED=true and FALKORDB_HOST=127.0.0.1 FALKORDB_PORT=6380" -ForegroundColor Cyan
