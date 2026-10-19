# Démarre Motflix : Docker Desktop, conteneurs, puis vérifie que chaque service répond.
. (Join-Path $PSScriptRoot 'common.ps1')
$Dir = $PSScriptRoot
$EnvFile = Join-Path $Dir '.env'
if (-not (Test-Path $EnvFile)) { Fail "Fichier .env introuvable dans $Dir. Lancez d'abord install.cmd." }

Step 'Moteur Docker'
Start-DockerDesktop
Ok 'Docker est prêt'

Step 'Démarrage des services'
Invoke-Compose $Dir @('up', '-d', '--remove-orphans')
Ok 'Conteneurs lancés'

$panel = Get-EnvValue $EnvFile 'PANEL_PORT'
$checks = [ordered]@{
  'Panel Motflix' = "http://127.0.0.1:$panel/api/health"; 'Films (Radarr)' = 'http://127.0.0.1:7878/ping'
  'Séries (Sonarr)' = 'http://127.0.0.1:8989/ping'; "Sites d'indexation (Prowlarr)" = 'http://127.0.0.1:9696/ping'
  'Téléchargement (qBittorrent)' = 'http://127.0.0.1:8090/'; 'Livres audio (Audiobookshelf)' = 'http://127.0.0.1:13378/healthcheck'
}
Step 'Vérification des services'
$deadline = (Get-Date).AddMinutes(4)
$failed = 0
foreach ($name in $checks.Keys) {
  $up = $false
  while (-not $up -and (Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -Uri $checks[$name] -UseBasicParsing -TimeoutSec 3 | Out-Null; $up = $true }
    catch { if ($_.Exception.Response) { $up = $true } else { Start-Sleep -Seconds 3 } }
  }
  if ($up) { Ok $name } else { Warn "$name ne répond pas"; $failed++ }
}
Write-Host ''
if ($failed -eq 0) { Write-Host '  Motflix est prêt.' -ForegroundColor Green } else { Warn "$failed service(s) ne répondent pas encore." }
Info "Panel Motflix : http://$(Get-LanIp):$panel"
