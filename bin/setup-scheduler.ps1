# Script para configurar automaticamente las tareas en Windows Task Scheduler
# Ejecutar como Administrador

Write-Host "Configurando Task Scheduler para OpsBoard Intake..." -ForegroundColor Cyan

# Verificar si se ejecuta como admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")

if (-not $isAdmin) {
    Write-Host "ERROR: Este script requiere permisos de Administrador" -ForegroundColor Red
    Write-Host "Por favor, abre PowerShell como Administrador y vuelve a intentar" -ForegroundColor Yellow
    exit 1
}

# Rutas
$projectPath = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$scriptPath = Join-Path $projectPath "bin\run-intake.bat"

Write-Host "Ruta del proyecto: $projectPath" -ForegroundColor Gray
Write-Host "Script a ejecutar: $scriptPath" -ForegroundColor Gray

# Verificar que el archivo .bat existe
if (-not (Test-Path $scriptPath)) {
    Write-Host "ERROR: No se encontro: $scriptPath" -ForegroundColor Red
    exit 1
}

# Crear las tareas
$tasks = @(
    @{ name = "OpsBoard Intake 12:00"; time = "12:00" },
    @{ name = "OpsBoard Intake 16:30"; time = "16:30" }
)

foreach ($task in $tasks) {
    Write-Host ""
    Write-Host "Creando tarea: $($task.name)" -ForegroundColor Yellow

    # Verificar si ya existe
    $existing = Get-ScheduledTask -TaskName $task.name -ErrorAction SilentlyContinue

    if ($existing) {
        Write-Host "   NOTA: La tarea ya existe, eliminando..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $task.name -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
        Start-Sleep -Milliseconds 500
    }

    try {
        # Crear trigger diario
        $trigger = New-ScheduledTaskTrigger -Daily -At $task.time

        # Crear accion - escapar bien la ruta
        $action = New-ScheduledTaskAction `
            -Execute $scriptPath `
            -WorkingDirectory $projectPath

        # Crear configuracion
        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -MultipleInstances IgnoreNew

        # Registrar tarea
        $principal = New-ScheduledTaskPrincipal -UserID "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest

        Register-ScheduledTask `
            -TaskName $task.name `
            -Trigger $trigger `
            -Action $action `
            -Settings $settings `
            -Principal $principal `
            -Description "Procesa automaticamente archivos de intake para OpsBoard" `
            -Force | Out-Null

        Write-Host "   OK: Tarea creada exitosamente" -ForegroundColor Green
    } catch {
        Write-Host "   ERROR: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "   Intentando metodo alternativo..." -ForegroundColor Yellow

        # Metodo alternativo usando schtasks
        try {
            $taskName = $task.name
            $time = $task.time
            $cmd = "`"$scriptPath`""

            # Eliminar si existe
            schtasks /delete /tn $taskName /f 2>$null
            Start-Sleep -Milliseconds 500

            # Crear nueva
            schtasks /create /tn $taskName /tr $cmd /sc daily /st $time /ru SYSTEM /f /rl HIGHEST 2>$null

            Write-Host "   OK: Tarea creada con metodo alternativo" -ForegroundColor Green
        } catch {
            Write-Host "   ERROR alternativo: $_" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "COMPLETADO" -ForegroundColor Green
Write-Host ""
Write-Host "Proximos pasos:" -ForegroundColor Cyan
Write-Host "  1. Abre Task Scheduler: Win + R -> taskschd.msc" -ForegroundColor Gray
Write-Host "  2. Busca las tareas 'OpsBoard Intake'" -ForegroundColor Gray
Write-Host "  3. Click derecho -> Run para probar" -ForegroundColor Gray
Write-Host "  4. Verifica los logs en: bin\intake-logs\" -ForegroundColor Gray
Write-Host ""
Write-Host "Para ejecutar manualmente:" -ForegroundColor Cyan
Write-Host "   npm run process-intake" -ForegroundColor Gray
Write-Host ""

pause
