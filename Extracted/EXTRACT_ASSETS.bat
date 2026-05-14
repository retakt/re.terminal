@echo off
echo 🚀 Running NeoServer Asset Extraction...
powershell -ExecutionPolicy Bypass -File "%~dp0copy_assets.ps1"
pause
