# ⚡ Inicio Rápido - Sistema de Intake Automático

## 🚀 Setup en 4 Pasos

### Paso 1: Instalar dependencias
```powershell
npm install
```

### Paso 2: Configurar Anthropic API Key ⚙️
Tu clave de Anthropic es necesaria para que Claude AI analice los documentos.

**Opción A: Vía Vercel CLI (recomendado)**
```powershell
vercel env add CLAUDE_API_KEY
# Selecciona "development" cuando pregunte
# Pega tu API key (obtén en https://console.anthropic.com/account/keys)
```

**Opción B: Mediante script interactivo**
```powershell
.\bin\setup-api-key.ps1
```

### Paso 3: Configurar Task Scheduler (automático)
```powershell
# Abre PowerShell como Administrador y ejecuta:
.\bin\setup-scheduler.ps1
```

El script crea automáticamente dos tareas:
- **OpsBoard Intake - 12:00** (mediodía)
- **OpsBoard Intake - 16:30** (tarde)

### Paso 4: Prueba manual
```powershell
npm run process-intake
```

Debería procesar archivos de test o mostrar un mensaje si la carpeta está vacía.

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

Ver: [INTAKE_SETUP.md](INTAKE_SETUP.md) para troubleshooting y configuración avanzada.

---

## ✅ Verificar que funciona

```powershell
# 1. Ver si la API key está configurada
vercel env ls | findstr CLAUDE_API_KEY

# 2. Ver si existen las tareas
Get-ScheduledTask -TaskName "*OpsBoard*"

# 3. Ejecutar una prueba
npm run process-intake
```

---

## 💡 Tips

| Acción | Comando |
|--------|---------|
| Procesar archivos manualmente | `npm run process-intake` |
| Ver logs | `Get-ChildItem bin\intake-logs\` |
| Actualizar API key | `vercel env add CLAUDE_API_KEY` |
| Editar horarios Task Scheduler | `taskschd.msc` |

---

**¡Sistema listo!** 🎉

Ahora simplemente deja archivos en la carpeta intake y serán procesados automáticamente por Claude AI.
