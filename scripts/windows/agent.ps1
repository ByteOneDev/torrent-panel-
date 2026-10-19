# Agent de Motflix pour Windows : surveille les demandes du panel et lance apply.ps1.
# Démarré à l'ouverture de session par une tâche planifiée (installée par install.ps1).
$queue = Join-Path $PSScriptRoot 'config\motflix\agent\queue\request.env'
$log = Join-Path $PSScriptRoot 'logs\agent.log'
while ($true) {
  if (Test-Path $queue) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'apply.ps1') *>> $log
  }
  Start-Sleep -Seconds 3
}
