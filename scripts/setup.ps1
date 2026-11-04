# Pi + ZenGate setup for Windows.
# This file holds no gateway URL and no key: it asks you for both.
# Run it with:  iex (irm "https://pastebin.com/raw/XXXXXXX")
$ErrorActionPreference = 'Stop'

$dir = if ($env:PI_CODING_AGENT_DIR) { $env:PI_CODING_AGENT_DIR } else { Join-Path $env:USERPROFILE '.pi\agent' }
$file = Join-Path $dir 'zengate.json'

Write-Host ''
Write-Host '=== Pi + ZenGate setup ===' -ForegroundColor Cyan
Write-Host "Config file: $file"

do {
  $url = (Read-Host 'Gateway /v1 URL').Trim().TrimEnd('/')
  if ($url -notlike '*/v1') { $url = "$url/v1" }
} until ($url -match '^https?://\S+$')

$secure = Read-Host 'Gateway API key (input hidden)' -AsSecureString
$key = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
if (-not $key) { throw 'No API key entered. Nothing was written.' }

New-Item -ItemType Directory -Force -Path $dir | Out-Null
$body = ([ordered]@{ baseUrl = $url; apiKey = $key } | ConvertTo-Json) + "`n"
[System.IO.File]::WriteAllText($file, $body, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote $file" -ForegroundColor Green

$models = Join-Path $dir 'models.json'
if ((Test-Path $models) -and (Select-String -Path $models -Pattern 'opencode2api' -Quiet)) {
  $names = @()
  try { $names = @((Get-Content -Raw -Path $models | ConvertFrom-Json).providers.PSObject.Properties.Name) } catch { $names = @() }
  if ($names.Count -eq 1 -and $names[0] -eq 'opencode2api') {
    Move-Item -Path $models -Destination "$models.disabled" -Force
    Write-Host 'Old models.json held only opencode2api, so it moved to models.json.disabled.' -ForegroundColor Yellow
  } else {
    Write-Host 'models.json holds other providers too. Delete its "opencode2api" entry by hand.' -ForegroundColor Yellow
  }
}

Write-Host ''
$rows = @(& pi --list-models 2>&1 | Select-String -Pattern '^\s*opencode2api')
$rows | Select-Object -First 3 | ForEach-Object { $_.Line }
Write-Host ("opencode2api models found: " + $rows.Count)
if ($rows.Count -eq 0) {
  Write-Host 'Zero models: restart Pi, then run  pi --list-models' -ForegroundColor Yellow
} else {
  Write-Host 'Done. In Pi run /zengate to see the catalog state.' -ForegroundColor Green
}
