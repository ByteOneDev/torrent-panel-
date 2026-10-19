# Désinstalle Motflix. Les médias sont conservés.
param([switch]$Yes)
. (Join-Path $PSScriptRoot 'common.ps1')
$Dir = $PSScriptRoot
if (-not $Yes) {
  $a = Read-Host '  Arrêter et retirer Motflix de cet ordinateur ? (o/n) [n]'
  if ($a -notin 'o', 'O', 'oui') { Info 'Annulé.'; exit 0 }
}
Step 'Conteneurs'
if (Test-Docker) { Invoke-Compose $Dir @('down', '--remove-orphans'); Ok 'Conteneurs retirés' } else { Warn 'Docker ne tourne pas : conteneurs non retirés.' }
Step 'Démarrage automatique et agent'
foreach ($t in 'Motflix', 'Motflix agent') { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue }
Ok 'Retirés'
Info "Configuration conservée dans $Dir (supprimez le dossier pour tout effacer). Vos médias sont intacts."
