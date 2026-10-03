# Next.js UI on http://localhost:3000; /api/* is proxied to the backend on :8010.
# Pass -Dev for hot reload during development.
param([switch]$Dev)
$root = $PSScriptRoot
$env:npm_config_cache = "$root\.npm-cache"
Set-Location "$root\frontend"
if ($Dev) { npm run dev } else { npm run start }
