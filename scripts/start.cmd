@echo off
setlocal
cd /d "%~dp0.."
title Znanie - sila: Arena
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Install the LTS version from https://nodejs.org and run this file again.
  start https://nodejs.org
  pause
  exit /b 1
)
node "%~dp0launch.mjs" %*
if errorlevel 1 pause
endlocal
