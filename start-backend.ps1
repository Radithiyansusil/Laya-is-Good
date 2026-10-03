# FastAPI + Laya on http://127.0.0.1:8010 (port 8000 is taken by another app on this machine).
$root = $PSScriptRoot
$env:USE_TF = "0"
$env:HF_HOME = "$root\.hf_cache"
$env:HF_HUB_OFFLINE = "1"
Set-Location "$root\backend"
& "$root\backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8010
