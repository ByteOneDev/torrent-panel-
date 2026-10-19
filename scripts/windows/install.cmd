@echo off
rem Motflix : double-cliquez sur ce fichier pour installer (Windows 10 / 11).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
pause
