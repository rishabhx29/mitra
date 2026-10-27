# Mitra — optional Laya decision tier (docs/DECISION_TIER_PLAN.md §1).
# Checks Python, installs the `laya` package when missing, and starts the
# laya-serve sidecar (POST /v1/systemone) on port 8899 in a NEW window so it
# keeps running after this script exits. Mitra probes it automatically; the
# Voice-panel badge shows "Fast decisions: Laya" when it is live.
#
# Usage (from app/):
#   powershell -ExecutionPolicy Bypass -File scripts\start-laya.ps1          # port 8899
#   powershell -ExecutionPolicy Bypass -File scripts\start-laya.ps1 -Port 9000
param(
  [int]$Port = 8899
)

$ErrorActionPreference = 'Stop'

# 1) Python 3.10+ must be on PATH (laya's runtime requirement).
try {
  $pyVersion = (& python --version) 2>&1
} catch {
  Write-Error 'Python was not found on PATH. Install Python 3.10+ from https://www.python.org/downloads/ and re-run this script.'
  exit 1
}
Write-Host "Found $($pyVersion)"

# 2) laya package: install when missing (idempotent — a no-op when present).
& pip show laya *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'laya not found — running pip install laya ...'
  & pip install laya
  if ($LASTEXITCODE -ne 0) {
    Write-Error 'pip install laya failed — fix the pip output above and re-run.'
    exit 1
  }
} else {
  Write-Host 'laya already installed.'
}

# 3) Start the sidecar detached in a new window so it survives this script.
Write-Host "Starting laya-serve --port $Port in a new window ..."
Start-Process -FilePath 'laya-serve' -ArgumentList '--port', "$Port" -WorkingDirectory (Get-Location)
Write-Host "laya-serve should be listening on http://127.0.0.1:$Port shortly."
Write-Host 'Mitra probes it automatically (LAYA_URL env overrides the default URL).'
