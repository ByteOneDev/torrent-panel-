# Installe Motflix sous Windows 10 / 11 : Docker Desktop si besoin, dossiers, configuration,
# démarrage automatique et agent du panel. Relançable sans risque.
#
# Le plus simple : double-cliquer sur install.cmd (à côté de ce fichier).
# Options : -Dir C:\Motflix  -DataDir D:\Medias  -Port 8080  -NoAutostart  -NoStart  -Yes
param(
  [string]$Dir = '',
  [string]$DataDir = '',
  [int]$Port = 0,
  [switch]$NoAutostart,
  [switch]$NoStart,
  [switch]$Yes
)

. (Join-Path $PSScriptRoot 'common.ps1')
$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Version = '0.1.0'

function Ask([string]$Question, [string]$Default) {
  if ($Yes) { return $Default }
  $a = Read-Host "  $Question [$Default]"
  if ([string]::IsNullOrWhiteSpace($a)) { return $Default } else { return $a.Trim() }
}

Write-Host ''
Write-Host "  Motflix — installation (v$Version, Windows)" -ForegroundColor White

# ─── 1. Docker Desktop ───────────────────────────────────────────────────
Step 'Docker'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Info "Docker Desktop n'est pas installé. Installation avec winget (droits administrateur demandés)…"
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "winget est introuvable. Installez Docker Desktop depuis https://www.docker.com/products/docker-desktop/ puis relancez."
  }
  winget install --id Docker.DockerDesktop --exact --accept-package-agreements --accept-source-agreements
  Warn 'Docker Desktop vient d''être installé : redémarrez Windows, ouvrez Docker Desktop une fois, puis relancez install.cmd.'
  exit 0
}
Start-DockerDesktop
Ok 'Docker est prêt'

# ─── 2. Dossiers ─────────────────────────────────────────────────────────
Step 'Dossiers'
if (-not $Dir) { $Dir = Ask "Dossier d'installation" (Join-Path $env:USERPROFILE 'Motflix') }
$EnvFile = Join-Path $Dir '.env'
$HasConfig = Test-Path $EnvFile
if (-not $DataDir) {
  $existing = Get-EnvValue $EnvFile 'DATA_DIR'
  if ($existing) { $DataDir = $existing -replace '/', '\' } else { $DataDir = Ask 'Dossier des médias et téléchargements' (Join-Path $Dir 'data') }
}
New-Item -ItemType Directory -Force -Path $Dir, $DataDir | Out-Null
foreach ($kind in 'films', 'series', 'livres', 'livres-audio') {
  New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "torrents\$kind"), (Join-Path $DataDir "media\$kind") | Out-Null
}
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir 'a-importer'), (Join-Path $DataDir 'media\.corbeille\films'), (Join-Path $DataDir 'media\.corbeille\series') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'logs') | Out-Null
Ok "Installation : $Dir"
Ok "Médias       : $DataDir"

# ─── 3. Fichiers ─────────────────────────────────────────────────────────
Step 'Copie des fichiers'
Copy-Item -Force (Join-Path $RepoDir 'docker\docker-compose.yml') $Dir
Copy-Item -Force (Join-Path $RepoDir 'docker\compose.windows.yml') $Dir
foreach ($f in 'common.ps1', 'start.ps1', 'stop.ps1', 'apply.ps1', 'agent.ps1', 'uninstall.ps1') {
  Copy-Item -Force (Join-Path $PSScriptRoot $f) $Dir
}
Ok 'Services et scripts copiés'

# ─── 4. Configuration (.env) ─────────────────────────────────────────────
Step 'Configuration'
$toDocker = { param($p) $p -replace '\\', '/' }
if (-not $HasConfig) {
  $panelPort = if ($Port) { $Port } else { 8080 }
  $values = [ordered]@{
    MOTFLIX_VERSION = $Version; DOCKER_RUNTIME = 'desktop'
    COMPOSE_FILE = 'docker-compose.yml;compose.windows.yml'; COMPOSE_PATH_SEPARATOR = ';'
    COMPOSE_PROFILES = 'novpn,plex'; PUID = '1000'; PGID = '1000'; TZ = 'Europe/Paris'
    DATA_DIR = (& $toDocker $DataDir); MOTFLIX_SRC = (& $toDocker $RepoDir); MOTFLIX_DIR = (& $toDocker $Dir)
    PANEL_PORT = "$panelPort"; TOOLS_BIND = '127.0.0.1'; TORRENT_PORT = '6881'
    RADARR_API_KEY = (New-Hex); SONARR_API_KEY = (New-Hex); PROWLARR_API_KEY = (New-Hex); LAZYLIBRARIAN_API_KEY = (New-Hex)
    QBITTORRENT_USER = 'admin'; QBITTORRENT_PASSWORD = (New-Hex 8)
    VPN_PROVIDER = ''; VPN_TYPE = 'wireguard'; VPN_COUNTRIES = ''; WIREGUARD_PRIVATE_KEY = ''; WIREGUARD_ADDRESSES = ''
    OPENVPN_USER = ''; OPENVPN_PASSWORD = ''; VPN_PORT_FORWARDING = 'off'; VPN_PORT_FORWARD_ONLY = 'off'; PLEX_CLAIM = ''
  }
  Write-Utf8 $EnvFile "# Motflix — généré par install.ps1. Contient des secrets : ne pas partager.`r`n"
  foreach ($k in $values.Keys) { Set-EnvValue $EnvFile $k $values[$k] }
  Ok 'Configuration enregistrée dans .env (sans VPN ; activable depuis le panel)'
} else {
  Set-EnvValue $EnvFile 'MOTFLIX_SRC' (& $toDocker $RepoDir)
  Set-EnvValue $EnvFile 'MOTFLIX_DIR' (& $toDocker $Dir)
  if ($Port) { Set-EnvValue $EnvFile 'PANEL_PORT' "$Port" }
  Ok 'Configuration existante conservée'
}

# ─── 5. Préconfiguration des outils (premier lancement seulement) ────────
Step 'Préconfiguration des outils'
$Config = Join-Path $Dir 'config'
foreach ($d in 'motflix\agent\queue', 'radarr', 'sonarr', 'prowlarr', 'lazylibrarian', 'qbittorrent\qBittorrent', 'gluetun', 'plex', 'audiobookshelf\config', 'audiobookshelf\metadata') {
  New-Item -ItemType Directory -Force -Path (Join-Path $Config $d) | Out-Null
}
function Seed-Arr([string]$App, [string]$Name, [int]$AppPort, [string]$Key) {
  $file = Join-Path $Config "$App\config.xml"
  if (Test-Path $file) { Info "$Name : configuration existante conservée"; return }
  Write-Utf8 $file @"
<Config>
  <BindAddress>*</BindAddress>
  <Port>$AppPort</Port>
  <EnableSsl>False</EnableSsl>
  <LaunchBrowser>False</LaunchBrowser>
  <ApiKey>$Key</ApiKey>
  <AuthenticationMethod>Forms</AuthenticationMethod>
  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
  <LogLevel>info</LogLevel>
  <UrlBase></UrlBase>
  <InstanceName>$Name</InstanceName>
  <AnalyticsEnabled>False</AnalyticsEnabled>
</Config>
"@
  Ok "$Name : clé API préparée"
}
Seed-Arr 'radarr' 'Radarr' 7878 (Get-EnvValue $EnvFile 'RADARR_API_KEY')
Seed-Arr 'sonarr' 'Sonarr' 8989 (Get-EnvValue $EnvFile 'SONARR_API_KEY')
Seed-Arr 'prowlarr' 'Prowlarr' 9696 (Get-EnvValue $EnvFile 'PROWLARR_API_KEY')

$qbtConf = Join-Path $Config 'qbittorrent\qBittorrent\qBittorrent.conf'
if (-not (Test-Path $qbtConf)) {
  # Même format que qBittorrent : PBKDF2-SHA512, 100 000 itérations, sel de 16 octets.
  $salt = New-Object byte[] 16
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
  $kdf = New-Object System.Security.Cryptography.Rfc2898DeriveBytes((Get-EnvValue $EnvFile 'QBITTORRENT_PASSWORD'), $salt, 100000, [System.Security.Cryptography.HashAlgorithmName]::SHA512)
  $hash = '@ByteArray(' + [Convert]::ToBase64String($salt) + ':' + [Convert]::ToBase64String($kdf.GetBytes(64)) + ')'
  Write-Utf8 $qbtConf @"
[BitTorrent]
Session\DefaultSavePath=/data/torrents
Session\TempPathEnabled=false
Session\DisableAutoTMMByDefault=false
Session\Port=$(Get-EnvValue $EnvFile 'TORRENT_PORT')
Session\QueueingSystemEnabled=true
Session\MaxActiveDownloads=3
Session\GlobalMaxRatio=1
Session\GlobalMaxSeedingMinutes=4320

[LegalNotice]
Accepted=true

[Preferences]
Connection\UPnP=true
WebUI\Port=8090
WebUI\Username=admin
WebUI\Password_PBKDF2="$hash"
WebUI\LocalHostAuth=false
WebUI\AuthSubnetWhitelistEnabled=true
WebUI\AuthSubnetWhitelist=172.31.250.128/25
WebUI\HostHeaderValidation=false
"@
  Ok 'qBittorrent : identifiants préparés'
}
$llConf = Join-Path $Config 'lazylibrarian\config.ini'
if (-not (Test-Path $llConf)) {
  Write-Utf8 $llConf "[General]`r`nhttp_port = 5299`r`napi_enabled = 1`r`napi_key = $(Get-EnvValue $EnvFile 'LAZYLIBRARIAN_API_KEY')`r`n"
  Ok 'LazyLibrarian : clé API préparée'
}

# ─── 6. Démarrage automatique et agent du panel ──────────────────────────
Step 'Démarrage automatique et agent'
$ps = (Get-Command powershell.exe).Source
$common = @{ Force = $true; Settings = (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)) }
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
if (-not $NoAutostart) {
  $action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Dir\start.ps1`"" -WorkingDirectory $Dir
  Register-ScheduledTask -TaskName 'Motflix' -Description 'Démarre Motflix à l''ouverture de session' -Action $action -Trigger $trigger @common | Out-Null
  Ok 'Motflix démarrera à l''ouverture de votre session'
}
# L'agent applique les changements demandés depuis le panel (VPN, liaison Plex).
$agentAction = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Dir\agent.ps1`"" -WorkingDirectory $Dir
Register-ScheduledTask -TaskName 'Motflix agent' -Description 'Applique les demandes du panel Motflix' -Action $agentAction -Trigger $trigger @common | Out-Null
Start-ScheduledTask -TaskName 'Motflix agent'
Write-Utf8 (Join-Path $Config 'motflix\agent\installed') "windows $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
Ok 'Agent actif'

# ─── 7. Téléchargement et démarrage ──────────────────────────────────────
if ($NoStart) {
  Info "Démarrage ignoré (-NoStart). Pour lancer Motflix : $Dir\start.ps1"
} else {
  Step 'Téléchargement des services (plusieurs Go la première fois, patience)'
  Invoke-Compose $Dir @('pull', '--ignore-buildable')
  Step 'Construction du panel'
  Invoke-Compose $Dir @('build', 'motflix')
  & (Join-Path $Dir 'start.ps1')
}

Write-Host ''
Write-Host '  Installation terminée.' -ForegroundColor Green
Info "Ouvrez le panel : http://$(Get-LanIp):$(Get-EnvValue $EnvFile 'PANEL_PORT')"
Info "qBittorrent : utilisateur admin, mot de passe $(Get-EnvValue $EnvFile 'QBITTORRENT_PASSWORD')"
Info "Commandes : $Dir\start.ps1 · stop.ps1 · uninstall.ps1"
