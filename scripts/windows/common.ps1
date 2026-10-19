# Fonctions communes aux scripts Windows de Motflix (PowerShell 5.1 et 7).

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Step([string]$Text) { Write-Host ''; Write-Host "> $Text" -ForegroundColor Cyan }
function Ok([string]$Text) { Write-Host "  [OK] $Text" -ForegroundColor Green }
function Info([string]$Text) { Write-Host "  $Text" }
function Warn([string]$Text) { Write-Host "  [!] $Text" -ForegroundColor Yellow }
function Fail([string]$Text) { Write-Host ''; Write-Host "[X] $Text" -ForegroundColor Red; exit 1 }

# ─── Fichier .env (même format que sous macOS / Linux : CLE='valeur') ────

function Get-EnvValue([string]$File, [string]$Key) {
  if (-not (Test-Path $File)) { return '' }
  foreach ($line in Get-Content -LiteralPath $File -Encoding UTF8) {
    if ($line.StartsWith("$Key=")) {
      $v = $line.Substring($Key.Length + 1)
      if ($v.Length -ge 2 -and $v.StartsWith("'") -and $v.EndsWith("'")) { $v = $v.Substring(1, $v.Length - 2) }
      return $v
    }
  }
  return ''
}

function Set-EnvValue([string]$File, [string]$Key, [string]$Value) {
  if ($Value.Contains("'") -or $Value.Contains("`n")) { Fail "La valeur de $Key contient un caractère interdit." }
  $lines = @()
  if (Test-Path $File) { $lines = @(Get-Content -LiteralPath $File -Encoding UTF8) }
  $found = $false
  $out = foreach ($line in $lines) {
    if ($line.StartsWith("$Key=")) { $found = $true; "$Key='$Value'" } else { $line }
  }
  if (-not $found) { $out = @($out) + "$Key='$Value'" }
  # UTF-8 sans BOM : Docker Compose lit mal le BOM.
  [System.IO.File]::WriteAllLines($File, [string[]]$out, (New-Object System.Text.UTF8Encoding($false)))
}

function New-Hex([int]$Bytes = 16) {
  $buf = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
  return -join ($buf | ForEach-Object { $_.ToString('x2') })
}

function Write-Utf8([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

# ─── Docker ──────────────────────────────────────────────────────────────

function Test-Docker {
  try { docker info --format '{{.ServerVersion}}' 2>$null | Out-Null; return $LASTEXITCODE -eq 0 } catch { return $false }
}

function Wait-Docker([int]$Seconds = 180) {
  $end = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $end) {
    if (Test-Docker) { return $true }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Start-DockerDesktop {
  if (Test-Docker) { return }
  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $exe) {
    Info 'Démarrage de Docker Desktop…'
    Start-Process -FilePath $exe | Out-Null
  }
  if (-not (Wait-Docker 240)) { Fail 'Docker ne répond pas. Lancez Docker Desktop à la main, puis relancez ce script.' }
}

function Invoke-Compose([string]$Dir, [string[]]$Arguments) {
  Push-Location $Dir
  try {
    & docker compose @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker compose $($Arguments -join ' ') a échoué" }
  } finally { Pop-Location }
}

function Get-LanIp {
  try {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback' } |
      Select-Object -First 1 -ExpandProperty IPAddress
    if ($ip) { return $ip }
  } catch { }
  return 'localhost'
}
