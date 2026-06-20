# 🔄 Sistema de Procesamiento Automático de Intake

Sistema que analiza automáticamente archivos de una carpeta y actualiza OpsBoard con los cambios detectados.

## 📋 Configuración

### 1. Carpeta de Entrada
Los archivos deben ir en:
```
C:\Users\Juan Rodriguez\OneDrive - Sercom Soluciones S.L\Escritorio\Pendientes Juan - Seguimiento NO borrar
```

**Formatos soportados:**
- `.eml` - Emails exportados (Outlook/Gmail)
- `.md` - Notas en Markdown
- `.txt` - Texto plano
- `.pdf` - PDF (requiere librería adicional)
- `.xlsx` - Excel (requiere librería adicional)

### 2. Ejecución Manual

Desde PowerShell o Terminal en la carpeta del proyecto:

```powershell
npm run process-intake
```

El script:
1. ✅ Lee archivos de la carpeta
2. 🤖 Analiza cada uno con Claude
3. 🔍 Detecta temas/proyectos relacionados
4. 💾 Actualiza automáticamente Supabase
5. 📁 Mueve archivos a `.processed/` para evitar duplicados

### 3. Ejecución Automática (Windows Task Scheduler)

#### Paso 1: Abrir Task Scheduler
- Presiona `Win + R`
- Escribe `taskschd.msc`
- Presiona Enter

#### Paso 2: Crear Tarea - Mediodía (12:00)

1. Click en **"Create Basic Task"** (lado derecho)
2. **Nombre:** `OpsBoard Intake - 12:00`
3. **Descripción:** `Procesa archivos de intake para OpsBoard`
4. Click **Next**

5. **Trigger (Cuándo ejecutarse):**
   - Selecciona: **Daily**
   - Start: Hoy a la fecha de hoy
   - Recurrence: Every 1 day
   - Time: **12:00:00**
   - Click **Next**

6. **Action (Qué ejecutar):**
   - Program/script:
     ```
     C:\Users\Juan Rodriguez\OneDrive - Sercom Soluciones S.L\Escritorio\opsboard-web\bin\run-intake.bat
     ```
   - Click **Next**

7. **Review** → **Finish**

#### Paso 3: Crear Segunda Tarea - Tarde (16:30)

Repetir el proceso anterior pero:
- **Nombre:** `OpsBoard Intake - 16:30`
- **Time:** `16:30:00`

#### Paso 4: Verificar las Tareas

En Task Scheduler:
- Navegua a: **Task Scheduler Library**
- Deberías ver las dos tareas creadas
- Click derecho → **Run** para probar

#### Paso 5: Ver Logs

Los logs se guardan en:
```
C:\Users\Juan Rodriguez\OneDrive - Sercom Soluciones S.L\Escritorio\opsboard-web\bin\intake-logs\
```

Cada ejecución genera un archivo: `process_YYYYMMDD_HHMMSS.log`

---

## 🎯 Flujo de Uso

### Caso: Email "Weekly Oferta Comercial"

1. **Guarda el email** como `.eml` o copia-pega el contenido en `.txt`:
   ```
   Pendientes Juan - Seguimiento NO borrar/
   └── weekly-oferta-comercial.txt
   ```

2. **Espera la siguiente ejecución automática** (12:00 o 16:30)
   O ejecuta manualmente en OpsBoard:
   - Ve a **Tablero**
   - Click botón **🔄 Procesar**
   - Ejecuta: `npm run process-intake`

3. **Claude analiza el archivo:**
   - Extrae: resumen, cambios, nuevas fechas
   - Detecta qué tema/proyecto actualizar
   - Si hay duda → pide confirmación manual

4. **Actualización automática:**
   - Nuevo comentario con fecha y resumen
   - Cambio de estado si aplica
   - Actualización de fecha_fin si aplica

5. **Archivo movido:**
   ```
   bin/intake-logs/
   └── .processed/
       └── 1719332400000_weekly-oferta-comercial.txt
   ```

---

## 📊 Análisis que hace Claude

El script envía a Claude:
- Contenido del archivo
- Lista de temas/proyectos actuales en OpsBoard

Claude responde con:
```json
{
  "matches": [
    {
      "type": "item|proyecto",
      "id": "UUID",
      "name": "Oferta tarjetas sin comisiones",
      "confidence": 0.95,
      "reason": "El email menciona específicamente esta oferta"
    }
  ],
  "updates": [
    {
      "field": "comentario",
      "value": "[2025-06-20] Lanzamiento exitoso. 15k SMS + 8k Email.",
      "reason": "Resumo de los resultados del lanzamiento"
    }
  ],
  "needsConfirmation": false,
  "extractedComment": "Oferta lanzada exitosamente con volumen alto"
}
```

---

## 🔐 Seguridad

- ✅ Acceso local solo (carpeta en tu máquina)
- ✅ Los archivos procesados se mueven a `.processed/`
- ✅ Log de auditoría en `intake-logs/`
- ✅ Supabase RLS previene acceso no autorizado
- ⚠️ Claude API procesa contenido del documento

---

## 🛠️ Troubleshooting

### El script no ejecuta
```powershell
# Verifica Node.js instalado
node --version

# Verifica dependencias
npm install

# Ejecuta manual
npm run process-intake
```

### Permiso denegado en Task Scheduler
- Abre Task Scheduler **como Administrador**
- Intenta crear la tarea de nuevo

### Archivos no se procesan
- Verifica la ruta: `Pendientes Juan - Seguimiento NO borrar`
- Revisa que el archivo tenga extensión `.eml`, `.md` o `.txt`
- Mira los logs: `bin/intake-logs/`

### Claude API error
- Verifica las variables de entorno en `.env.local`
- Checkea que el token de Anthropic sea válido
- Revisa que Supabase esté accesible

---

## 📝 Próximas Mejoras

- [ ] Soporte para PDF (requiere `pdf-parse`)
- [ ] Soporte para Excel (requiere `xlsx`)
- [ ] Confirmación manual para matches dudosos
- [ ] Dashboard de estadísticas de intake
- [ ] Historial visual en OpsBoard
- [ ] Integración con Gmail (procesar emails automáticamente)

---

## ✅ Checklist de Setup

- [ ] Carpeta `Pendientes Juan - Seguimiento NO borrar` existe
- [ ] `npm install` ejecutado
- [ ] `npm run process-intake` funciona manualmente
- [ ] Task Scheduler abierto
- [ ] Tarea 1: 12:00 creada
- [ ] Tarea 2: 16:30 creada
- [ ] Ambas tareas probadas (Run)
- [ ] Logs visibles en `bin/intake-logs/`

¡Listo! 🎉 El sistema está completamente configurado.
