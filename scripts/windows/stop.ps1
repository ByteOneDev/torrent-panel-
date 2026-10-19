# Arrête proprement tous les services Motflix (les données sont conservées).
. (Join-Path $PSScriptRoot 'common.ps1')
if (-not (Test-Docker)) { Info 'Docker ne tourne pas : rien à arrêter.'; exit 0 }
Step 'Arrêt des services'
Invoke-Compose $PSScriptRoot @('stop')
Ok 'Motflix est arrêté'
