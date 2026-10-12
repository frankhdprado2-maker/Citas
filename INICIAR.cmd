@echo off
setlocal
title Un plan contigo
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instala Node.js 24 LTS desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm.cmd run setup
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo Invitacion: http://localhost:3000
echo Deja esta ventana abierta mientras uses la app. Ctrl+C para detenerla.
echo.
call npm.cmd start
pause
