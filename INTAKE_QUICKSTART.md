# ⚡ Inicio Rápido - Sistema de Intake Automático

## 🚀 Setup en 3 Pasos

### Paso 1: Instalar dependencias
```powershell
npm install
```

### Paso 2: Configurar Task Scheduler (automático)
```powershell
# Abre PowerShell como Administrador y ejecuta:
.\bin\setup-scheduler.ps1
```

El script crea automáticamente dos tareas:
- **OpsBoard Intake - 12:00** (mediodía)
- **OpsBoard Intake - 16:30** (tarde)

### Paso 3: Prueba manual
```powershell
npm run process-intake
```

---

## 📂 Usar el Sistema

### Añadir un archivo para procesar

1. Descarga/guarda un email como `.eml` o `.txt`:
   ```
   C:\Users\Juan Rodriguez\OneDrive - Sercom Soluciones S.L\Escritorio\Pendientes Juan - Seguimiento NO borrar\
   └── weekly-oferta-comercial.txt
   ```

2. **Opción A: Esperar ejecución automática**
   - Se ejecutará automáticamente a las 12:00 y 16:30

3. **Opción B: Ejecutar ahora**
   - En OpsBoard → Vista **Tablero** → Click **🔄 Procesar**
   - O en terminal: `npm run process-intake`

4. **Resultado:**
   - El archivo se analiza con Claude
   - Los temas/proyectos se actualizan automáticamente
   - El archivo se mueve a `.processed/`

---

## 📖 Documentación Completa

Ver: [INTAKE_SETUP.md](INTAKE_SETUP.md)

Para troubleshooting y configuración avanzada.

---

## ✅ Verificar que funciona

```powershell
# 1. Ver si existen las tareas
Get-ScheduledTask -TaskName "*OpsBoard Intake*"

# 2. Ver logs de la última ejecución
Get-Content "bin\intake-logs\*.log" | Select-Object -Last 20

# 3. Ejecutar una tarea manualmente
Start-ScheduledTask -TaskName "OpsBoard Intake - 12:00"
```

---

## 💡 Tips

| Acción | Comando |
|--------|---------|
| Procesar archivos manualmente | `npm run process-intake` |
| Ver logs | `Get-ChildItem bin\intake-logs\` |
| Limpiar archivos procesados | `Remove-Item bin\intake-logs\.processed\*` |
| Editar horarios | Task Scheduler → Right-click tarea → Edit |

---

**¡Listo!** El sistema está configurado. 🎉

Ahora simplemente deja archivos en la carpeta y ellos se procesarán automáticamente.
