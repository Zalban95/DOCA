# DOCA on Windows in one command (TODO H1.8; docs/design/hive.md §7):
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 [-Dir C:\doca] [-From <checkout>] [-NoBoot] [-NoStart]
# Node 22 is checked (winget install OpenJS.NodeJS.LTS if it is missing), the code fetched (or copied from a checkout),
# its dependencies installed, a Task Scheduler entry added for sign-in, and the panel started.
param(
  [string]$Dir = "$env:USERPROFILE\doca",
  [string]$Repo = 'https://github.com/Zalban95/DOCA.git',
  [string]$From = '',
  [switch]$NoBoot,
  [switch]$NoStart,
  [string]$Share = ''   # yes|no: offer the skills and specialists your agents learn to the project (asked when not given)
)
$ErrorActionPreference = 'Stop'
$port = if ($env:PORT) { $env:PORT } else { 4242 }

# ── Node 22 ──
$node = Get-Command node -ErrorAction SilentlyContinue
$ok = $false
if ($node) { & node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)'; $ok = ($LASTEXITCODE -eq 0) }
if (-not $ok) {
  Write-Host "DOCA needs Node.js 22.5 or newer$(if ($node) { " (this machine has $(& node -v))" })."
  Write-Host '  Install it with:  winget install OpenJS.NodeJS.LTS   (or from https://nodejs.org), then open a new terminal and run this again.'
  exit 1
}

# ── The code ──
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
if ($From) {
  Write-Host "Copying DOCA from $From to $Dir"
  # The checkout's tracked files only: its own state and anything untracked stay behind.
  $tracked = @(git -C $From ls-files 2>$null)
  if ($LASTEXITCODE -eq 0 -and $tracked.Count) {
    foreach ($f in $tracked) { $dest = Join-Path $Dir $f; New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null; Copy-Item -LiteralPath (Join-Path $From $f) -Destination $dest -Force }
  } else {
    $skip = @('node_modules', '.doca', '.releases', '.git', '.certs', '.env', '.dashboard-prefs.json', '.setup-code')
    Get-ChildItem -LiteralPath $From -Force | Where-Object { $skip -notcontains $_.Name } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Dir -Recurse -Force }
  }
} elseif (Test-Path (Join-Path $Dir '.git')) {
  Write-Host "Updating DOCA in $Dir"; git -C $Dir pull --ff-only
} else {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Host 'git is needed to fetch DOCA (winget install Git.Git), or pass -From a checkout.'; exit 1 }
  Write-Host "Fetching DOCA into $Dir"; git clone --depth 1 $Repo $Dir
}

# ── Dependencies ──
Write-Host 'Installing its dependencies'
Push-Location $Dir
try {
  & npm ci --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed ($LASTEXITCODE)" }

  # ── Sharing what the agents learn (CONSTITUTION §0): asked once, the owner's answer; Settings → Packs changes it ──
  if (-not $Share -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    Write-Host 'When your agents find a new way to do something, they keep it as a skill or a specialist.'
    $Share = Read-Host 'Offer those to the DOCA project, so other installs get them too? Nothing is sent without your click. [y/N]'
    if (-not $Share) { $Share = 'no' }
  }
  if ($Share -match '^(y|yes|on)$') { & node bin/doca-sharing.js on }
  elseif ($Share -match '^(n|no|off)$') { & node bin/doca-sharing.js off }
  else { Write-Host 'Sharing with the project: not decided - Settings -> Packs asks.' }

  # ── Start at sign-in, and now ──
  if (-not $NoBoot) { & node bin/doca-launch.js enable; if ($LASTEXITCODE -ne 0) { Write-Host 'Start-at-sign-in was not added (see above); DOCA still runs.' } }
  if (-not $NoStart) {
    if (-not $NoBoot -and (schtasks /Query /TN DOCA 2>$null)) { schtasks /Run /TN DOCA | Out-Null }
    else { Start-Process -FilePath node -ArgumentList 'bin/doca-launch.js', 'start' -WorkingDirectory $Dir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Dir 'doca.log') -RedirectStandardError (Join-Path $Dir 'doca.err.log') }
    # The certificate is self-signed: PowerShell 7 skips the check by a switch, Windows PowerShell 5.1 by a callback.
    $skipCert = if ($PSVersionTable.PSVersion.Major -ge 6) { @{ SkipCertificateCheck = $true } } else { [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }; @{} }
    $up = $false
    for ($i = 0; $i -lt 60; $i++) {
      try { [void](Invoke-WebRequest -Uri "https://127.0.0.1:$port/login" -UseBasicParsing -TimeoutSec 2 @skipCert); $up = $true; break } catch { Start-Sleep -Seconds 1 }
    }
  }
} finally { Pop-Location }

Write-Host ''
Write-Host "✓ DOCA is in $Dir."
if (-not $NoStart -and -not $up) { Write-Host "  ✗ It did not answer on port $port within a minute. Its output is in $Dir\doca.log and $Dir\doca.err.log." }
if (-not $NoStart) { Write-Host "  Open https://localhost:$port on this machine to create its owner — no code is needed there." }
Write-Host "  From another device on your tailnet: open the panel there, and the setup code it asks for is then in $Dir\.setup-code and in the panel's log."
Write-Host '  The certificate is self-signed: your browser will ask once.'
Write-Host "  Then Settings → Set-up (offered at the first sign-in) gives DOCA's agent a model: one this machine runs, or a provider's key."
