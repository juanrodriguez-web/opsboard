@echo off
REM Script para ejecutar el procesamiento de intake desde Task Scheduler
REM Guarda logs en bin\intake-logs\

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%..
set LOG_DIR=%SCRIPT_DIR%intake-logs
set TIMESTAMP=%date:~-4,4%%date:~-10,2%%date:~-7,2%_%time:~0,2%%time:~3,2%%time:~6,2%

REM Crear carpeta de logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM Ejecutar npm script y guardar output
cd /d "%PROJECT_DIR%"
call npm run process-intake > "%LOG_DIR%\process_%TIMESTAMP%.log" 2>&1

if %ERRORLEVEL% neq 0 (
    echo Error ejecutando process-intake >> "%LOG_DIR%\process_%TIMESTAMP%.log"
    exit /b 1
)

echo Procesamiento completado >> "%LOG_DIR%\process_%TIMESTAMP%.log"
exit /b 0
