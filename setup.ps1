# One-time setup. Everything (Python venv, pip/npm caches, model weights, node_modules) stays inside this folder.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$env:PIP_CACHE_DIR = "$root\.pip-cache"
$env:HF_HOME = "$root\.hf_cache"
$env:npm_config_cache = "$root\.npm-cache"

if (-not (Test-Path "$root\backend\.venv")) { python -m venv "$root\backend\.venv" }
& "$root\backend\.venv\Scripts\python.exe" -m pip install --upgrade pip
& "$root\backend\.venv\Scripts\python.exe" -m pip install -r "$root\backend\requirements.txt"
& "$root\backend\.venv\Scripts\python.exe" "$root\backend\download_model.py"

Push-Location "$root\frontend"
npm install
npm run build
Pop-Location
Write-Host "Setup complete. Run .\start-backend.ps1 and .\start-frontend.ps1 in two terminals."
