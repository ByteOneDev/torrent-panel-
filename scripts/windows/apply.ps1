# Applique une demande déposée par le panel (VPN, liaison Plex). Équivalent de apply.sh.
# Lancé par agent.ps1 dès qu'une demande arrive, ou à la main.
. (Join-Path $PSScriptRoot 'common.ps1')
$Dir = $PSScriptRoot
$EnvFile = Join-Path $Dir '.env'
$Agent = Join-Path $Dir 'config\motflix\agent'
$Request = Join-Path $Agent 'queue\request.env'
$Result = Join-Path $Agent 'result.env'
if (-not (Test-Path $Request)) { Info 'Aucune demande en attente.'; exit 0 }

# La demande peut contenir des secrets : on la lit puis on la supprime aussitôt.
$lines = @(Get-Content -LiteralPath $Request -Encoding UTF8)
Remove-Item -LiteralPath $Request -Force
$script:id = ''
function Write-Result([bool]$Success, [string]$Message) {
  $ok = if ($Success) { '1' } else { '0' }
  Write-Utf8 $Result "ID=$script:id`nOK=$ok`nMESSAGE=$Message`nFINISHED=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))`n"
  if ($Success) { Ok $Message } else { Warn $Message }
}

$allowed = 'VPN_PROVIDER', 'VPN_TYPE', 'VPN_COUNTRIES', 'WIREGUARD_PRIVATE_KEY', 'WIREGUARD_ADDRESSES', 'OPENVPN_USER', 'OPENVPN_PASSWORD', 'VPN_PORT_FORWARDING', 'VPN_PORT_FORWARD_ONLY'
$updates = @{}; $vpn = ''; $claim = ''
foreach ($line in $lines) {
  if (-not $line) { continue }
  $i = $line.IndexOf('='); if ($i -lt 1) { continue }
  $key = $line.Substring(0, $i); $value = $line.Substring($i + 1)
  if ($value -match '[''"`$\\]') { Write-Result $false "Valeur refusée pour $key"; exit 1 }
  switch ($key) {
    'ID' { $script:id = $value }
    'VPN_ENABLED' { if ($value -notin '0', '1') { Write-Result $false 'Valeur refusée pour VPN_ENABLED'; exit 1 }; $vpn = $value }
    'PLEX_CLAIM' { if ($value -notmatch '^claim-[A-Za-z0-9_-]+$') { Write-Result $false 'Code Plex refusé'; exit 1 }; $claim = $value }
    default { if ($allowed -notcontains $key) { Write-Result $false "Réglage refusé : $key"; exit 1 }; $updates[$key] = $value }
  }
}
if (-not $script:id) { Write-Result $false 'Demande sans identifiant'; exit 1 }
Start-DockerDesktop

# Liaison de Plex : Plex n'accepte la réclamation que depuis sa propre machine.
if ($claim) {
  $code = docker exec motflix-plex curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:32400/myplex/claim?token=$claim"
  if ($code -eq '200') { Write-Result $true 'Serveur Plex lié à votre compte' } else { Write-Result $false "Plex a refusé la liaison (code $code)." }
  exit 0
}

if (-not $vpn) { Write-Result $false 'Demande incomplète'; exit 1 }
foreach ($k in $updates.Keys) { Set-EnvValue $EnvFile $k $updates[$k] }
$profiles = @((Get-EnvValue $EnvFile 'COMPOSE_PROFILES').Split(',') | Where-Object { $_ -and $_ -notin 'vpn', 'novpn' })
$mode = if ($vpn -eq '1') { 'vpn' } else { 'novpn' }
Set-EnvValue $EnvFile 'COMPOSE_PROFILES' ((@($profiles) + $mode) -join ',')

if ($mode -eq 'vpn') { Invoke-Compose $Dir @('rm', '-sf', 'qbittorrent') } else { Invoke-Compose $Dir @('rm', '-sf', 'gluetun', 'qbittorrent-vpn') }
try { Invoke-Compose $Dir @('up', '-d', '--remove-orphans') }
catch {
  if ($mode -eq 'vpn') { Write-Result $false 'Le VPN ne se connecte pas : vérifiez vos identifiants. Les téléchargements restent coupés, sans fuite.' }
  else { Write-Result $false 'Docker n''a pas pu recréer les services.' }
  exit 1
}
if ($mode -eq 'novpn') { Write-Result $true 'VPN désactivé : les téléchargements utilisent votre connexion'; exit 0 }
$end = (Get-Date).AddMinutes(2)
while ((Get-Date) -lt $end) {
  if ((docker inspect -f '{{.State.Health.Status}}' motflix-gluetun 2>$null) -eq 'healthy') { Write-Result $true 'VPN connecté : les téléchargements passent par le VPN'; exit 0 }
  Start-Sleep -Seconds 3
}
Write-Result $false 'Le VPN ne se connecte pas : vérifiez vos identifiants. Les téléchargements restent coupés, sans fuite.'
exit 1
