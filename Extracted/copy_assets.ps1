# NeoServer Asset Extraction Script
# Run this in PowerShell to copy all fonts, themes, languages, and assets

$src = "C:\Users\re_Lax\Desktop\NeoServer\Payload\NeoServer.app"
$dst = "C:\Users\re_Lax\Desktop\NeoServer\Extracted"

Write-Host "🚀 Starting NeoServer Asset Extraction..." -ForegroundColor Green

# Create directories
$dirs = @(
    "$dst\Editor\fonts", "$dst\Editor\themes", "$dst\Editor\languages", "$dst\Editor\plugins",
    "$dst\Terminal\fonts"
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

# Copy Fonts
$fonts = @(
    "DejaVuSansMonoPowerline.ttf",
    "FiraCodeNerdFontCompleteMono-Regular.ttf",
    "Hack-Bold.ttf",
    "Hack-Regular.ttf",
    "JetBrainsMonoNerdFontCompleteMono-Regular.ttf",
    "SourceCodeProPowerline-Bold.otf",
    "SourceCodeProPowerline-Regular.otf",
    "UbuntuMonoPowerline-Bold.ttf",
    "UbuntuMonoPowerline-Regular.ttf"
)

Write-Host "📦 Copying Fonts..." -ForegroundColor Yellow
foreach ($f in $fonts) {
    if (Test-Path "$src\$f") {
        Copy-Item "$src\$f" "$dst\Editor\fonts\$f" -Force
        Copy-Item "$src\$f" "$dst\Terminal\fonts\$f" -Force
        Write-Host "  ✅ $f"
    } else {
        Write-Host "  ❌ Missing: $f" -ForegroundColor Red
    }
}

# Copy Themes
Write-Host "🎨 Copying Themes..." -ForegroundColor Yellow
$themes = Get-ChildItem -Path $src -Filter "RunestoneThemes_*.bundle" -Directory
foreach ($t in $themes) {
    Copy-Item $t.FullName "$dst\Editor\themes\$($t.Name)" -Recurse -Force
    Write-Host "  ✅ $($t.Name)"
}

# Copy Languages
Write-Host "🌍 Copying TreeSitter Languages..." -ForegroundColor Yellow
$langs = Get-ChildItem -Path $src -Filter "TreeSitterLanguages_*.bundle" -Directory
foreach ($l in $langs) {
    Copy-Item $l.FullName "$dst\Editor\languages\$($l.Name)" -Recurse -Force
    Write-Host "  ✅ $($l.Name)"
}

# Copy Plugins
Write-Host "🔌 Copying Plugins..." -ForegroundColor Yellow
$plugins = @("SymbolPicker_SymbolPicker.bundle", "Runestone_Runestone.bundle")
foreach ($p in $plugins) {
    if (Test-Path "$src\$p") {
        Copy-Item "$src\$p" "$dst\Editor\plugins\$p" -Recurse -Force
        Write-Host "  ✅ $p"
    }
}

# Copy Terminal Assets
Write-Host "💻 Copying Terminal Assets..." -ForegroundColor Yellow
$termAssets = @("bell.m4a", "server_terminal.js", "473.server_terminal.js")
foreach ($a in $termAssets) {
    if (Test-Path "$src\$a") {
        Copy-Item "$src\$a" "$dst\Terminal\$a" -Force
        Write-Host "  ✅ $a"
    }
}

# Copy HTML Files
Write-Host "📄 Copying HTML Files..." -ForegroundColor Yellow
if (Test-Path "$src\neoeditor.html") {
    Copy-Item "$src\neoeditor.html" "$dst\Editor\index.html" -Force
    Write-Host "  ✅ neoeditor.html -> Editor/index.html"
}
if (Test-Path "$src\ssh.html") {
    Copy-Item "$src\ssh.html" "$dst\Terminal\index.html" -Force
    Write-Host "  ✅ ssh.html -> Terminal/index.html"
}

Write-Host "`n🎉 Extraction Complete! All assets copied successfully." -ForegroundColor Green
Write-Host "📂 Location: $dst" -ForegroundColor Cyan
