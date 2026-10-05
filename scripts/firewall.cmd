@echo off
setlocal
rem Adds a Windows Firewall rule so phones can open the game. Needs admin rights once.
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
node "%~dp0firewall.mjs"
pause
