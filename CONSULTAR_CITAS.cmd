@echo off
setlocal
cd /d "%~dp0"
call npm.cmd run citas:excel
if errorlevel 1 (
  echo No se pudo crear la copia de consulta.
  pause
  exit /b 1
)
start "" "%~dp0consultas"
