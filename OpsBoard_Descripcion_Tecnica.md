# OpsBoard — Descripción Técnica

> Documento interno para el equipo de Digital de Vodafone Spain.  
> Útil para automatizar flujos, integraciones externas y mejorar el reporting.

---

## ¿Qué es OpsBoard?

OpsBoard es una **aplicación web de gestión operativa** diseñada para el equipo de Digital de Vodafone Spain. Centraliza el seguimiento de iniciativas, temas de trabajo, proyectos, campañas CVM y reporting ejecutivo en una única interfaz, tomando como fuente de verdad un **Google Sheet compartido**.

Está desplegada en **Vercel** y es accesible desde cualquier navegador sin instalación.

---

## Arquitectura general

```
Google Sheet (fuente de verdad)
        │
        │  Sheets API v4 (lectura)
        ▼
  Vercel Serverless Functions  ──►  /api/data.js
  (Node.js, sin base de datos)  ──►  /api/update.js
                                ──►  /api/claude.js
        │
        │  fetch() desde el cliente
        ▼
  React SPA (Vite)
  src/App.jsx  ←→  localStorage (overrides locales)
```

- **Frontend**: React 18 + Vite, fichero único `src/App.jsx` (~1800 líneas), estilos inline.
- **Backend**: 3 funciones serverless en `/api/`, sin base de datos.
- **Estado persistente**: Google Sheets (datos master) + `localStorage` del navegador (cambios locales pendientes).
- **Repo**: `github.com/Juangas50/opsboard` — cada push a `main` despliega automáticamente vía Vercel.

---

## Variables de entorno (Vercel)

| Variable | Descripción |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT` | JSON de la Service Account de Google Cloud (minificado, una línea). Necesita permisos de lectura en Sheets y escritura en Drive. |
| `SHEET_ID` | ID del Google Sheet principal (`1tOCfHz3MDowqoIfCvUj6H7ljKvTlfM5Xsm_snZ41Bv4`). |
| `QUEUE_FOLDER_ID` | ID de la carpeta de Drive donde se depositan los JSON de cambios (`1e5kA71XphmZ6DSyYQHBxHaDB8DhEYXcG`). |
| `CLAUDE_API_KEY` | API Key de Anthropic para las funciones de IA (Intake y Reporte Semanal). |

---

## API Endpoints

### `GET /api/data`
Lee el Google Sheet completo y devuelve todos los datos para hidratación del frontend.

**Flujo:**
1. Obtiene la lista de todas las pestañas del Sheet.
2. Hace un `batchGet` de todas las pestañas (columnas A–Z).
3. Aplana los datos separando pestañas con filas vacías.
4. Devuelve `{ values: Array<Array<string>>, updatedAt: ISO8601 }`.

**Headers:** `Cache-Control: no-store` (siempre datos frescos).

---

### `POST /api/update`
Registra un cambio de un tema en una cola asíncrona en Google Drive.

**Body esperado:**
```json
{
  "tema": "Nombre del tema (clave de búsqueda)",
  "estado": "Según lo planificado",
  "propietario": "Juan Rodriguez Peisel",
  "prioridad": "P1",
  "fechaFin": "2025-08-31",
  "proyecto": "App Vodafone",
  "notas": "Actualización manual"
}
```

Solo `tema` es obligatorio. El resto de campos son opcionales.

**Flujo:**
1. Construye un objeto `payload` con `action: "upsert"` y los campos recibidos.
2. Sube un fichero JSON a la carpeta de Drive (`QUEUE_FOLDER_ID`).
3. Un **Google Apps Script** (lado Sheet) monitoriza esa carpeta y aplica los cambios al Sheet cuando se activa.

**Nota:** Los cambios NO se aplican al Sheet de forma síncrona. Hay un delay hasta que Apps Script procesa la cola. Mientras tanto, los cambios se mantienen en `localStorage` del navegador (marcados con `~local`).

---

### `POST /api/claude`
Proxy hacia la API de Anthropic que mantiene la API Key en el servidor.

**Body:** cualquier payload válido de `POST /v1/messages` de Anthropic.  
**Modelos usados internamente:** `claude-haiku-4-5-20251001` (IA Intake) y `claude-sonnet-4-6` (Reporte Semanal).

---

## Estructura del Google Sheet

El parser (`src/parser.js`) detecta las tablas automáticamente por sus cabeceras. El Sheet puede tener múltiples pestañas con distintos tipos de datos.

### Pestaña: Temas / Iniciativas
Tabla principal. Se detecta por tener las columnas `Objetivo` + `Prioridad` + `Notas`.

| Columna | Descripción |
|---|---|
| `Tema` | Nombre del tema (clave única de búsqueda) |
| `Objetivo` | Descripción del objetivo |
| `Estado` | `No iniciado` / `Según lo planificado` / `En curso` / `En peligro` / `Retrasado` / `Hecho` |
| `Prioridad` | `P0` / `P1` / `P2` / `P3` |
| `Propietario` | Nombre del responsable |
| `Fecha de inicio` | `DD/MM/YYYY` |
| `Fecha de finalización` | `DD/MM/YYYY` |
| `Proyecto` | Nombre del proyecto al que pertenece (opcional) |
| `Archivos relacionados` | Links o referencias |
| `Notas` | Notas de seguimiento |

**Mapeo de estados al modelo interno:**

| Sheet | OpsBoard |
|---|---|
| No iniciado | `pending` |
| Según lo planificado / En curso / BAU | `inprogress` |
| En peligro / Retrasado | `blocked` |
| Hecho | `done` |

**Clasificación automática de categoría** (`inferCat` en `parser.js`):

| Categoría | Palabras clave detectadas |
|---|---|
| `cvm` | cvm, retención, fideliz, upgrade, upsell, loyalty, ciclo de vida... |
| `product` | app, email, onboarding, esim, kyc, digital, campañas, notipush... |
| `tools` | frontal, kiosco, retail, bpmn, plataforma, atc, vending... |
| `projects` | cualquier tema que no encaje en las anteriores (fallback) |

---

### Pestaña: Subtareas
Se detecta por tener las columnas `Subtarea` + `Tema padre`.

| Columna | Descripción |
|---|---|
| `Subtarea` | Nombre de la subtarea |
| `Tema padre` | Nombre del tema al que pertenece (debe coincidir exactamente) |
| `Estado` | Mismo mapeo que temas |
| `Propietario` | Responsable |
| `Prioridad` | P0–P3 |
| `Fecha de finalización` | `DD/MM/YYYY` |
| `Notas` | Notas |
| `ID` | Identificador opcional |

---

### Pestaña: Proyectos
Se detecta por tener la columna `Nombre` pero **sin** `Objetivo` ni `PYNAME`.

| Columna | Descripción |
|---|---|
| `Nombre` | Nombre del proyecto |
| `Descripción` | Descripción breve |
| `Estado` | Mismo mapeo que temas |
| `Prioridad` | P0–P3 |
| `Propietario` | Responsable |
| `Fecha inicio` | `DD/MM/YYYY` |
| `Fecha fin` | `DD/MM/YYYY` |
| `Notas` | Notas generales |

Los temas se vinculan a proyectos mediante la columna `Proyecto` en la tabla de temas.

---

### Pestaña: Campañas CVM
Se detecta por tener la columna `PYNAME`.

| Columna | Descripción |
|---|---|
| `Fecha` | Fecha de envío |
| `PYNAME` | Nombre técnico de la campaña |
| `Tipo` | `Oferta One Shot` / `Reminder` / `BAU` / `Reactivación` |
| `Audiencia` | Descripción del segmento objetivo |
| `Volumen` | Número de líneas impactadas |
| `Copy` | Texto del mensaje |
| `Canal` | `SMS` / `Push` / `Email` |
| `Estado` | `Planificado` / `Enviado` / `Cancelado` |

---

## Funcionalidades del frontend

### 📋 Tablero (Kanban / Lista)
- Visualización de todos los temas en columnas por estado: Pendiente / En Curso / Bloqueado / Completado.
- Filtros por categoría (Iniciativas, Producto, Herramientas, CVM), propietario y búsqueda de texto libre.
- Vista lista alternativa con ordenación por columnas.
- Botón `→` en cada tarjeta para avanzar el estado en un click (guarda en Sheet vía cola).
- Creación de nuevos temas desde el propio tablero.

### 🗂️ Proyectos
- Cards por proyecto con barra de progreso (% completado por estados).
- Gantt visual de los temas vinculados al proyecto.
- Modal de proyecto con tres pestañas: **Temas** (lista clicable), **Gantt**, **Notas** (comentarios internos).
- Creación de temas directamente desde el modal del proyecto.
- Los temas del modal son clicables y abren el modal de detalle del tema.

### 📊 Dashboard
- KPIs en tiempo real: Total, En Curso, Bloqueados, Riesgo, Vencidos, Completados.
- Gráficos de carga de equipo (Juan vs Francisco), distribución por área (pie chart) y pipeline por estado (bar chart horizontal).
- Filtrable por persona y por categoría.

### 📅 Campañas CVM
- Vista de campañas agrupadas por fecha.
- Filtros por estado (Planificado / Enviado / Cancelado).
- Modal de detalle con audiencia, copy y canal.

### ✨ IA Intake
- Pega cualquier texto (email, acta, nota) y Claude detecta automáticamente las tareas, categoría, prioridad y fecha estimada.
- Preview de los temas detectados antes de confirmar.
- Al confirmar, los temas se añaden al tablero en modo local.

### 📋 Reporte Semanal
- Genera un resumen ejecutivo completo a partir del estado actual del tablero.
- Dos formatos: **Ejecutivo dirección** (estructura PMO con estado general, avances, riesgos, próximos pasos) y **Bullets standup**.
- Botón de copia directa al portapapeles.

---

## Persistencia local (localStorage)

OpsBoard usa `localStorage` del navegador para tres propósitos:

| Key | Contenido |
|---|---|
| `obs-status-overrides` | Cambios de estado, propietario, prioridad, fecha, proyecto pendientes de sincronizar con el Sheet. Los items afectados muestran el badge `~local`. |
| `obs-comments` | Comentarios/actualizaciones añadidos a temas desde el modal. |
| `obs-proj-comments` | Notas añadidas a proyectos. |

Los overrides se aplican automáticamente sobre los datos frescos del Sheet cada vez que se recarga la página, de forma que los cambios locales persisten aunque el Sheet no haya procesado todavía la cola de Drive.

---

## Flujo completo de un cambio de estado

```
Usuario cambia estado en OpsBoard
        │
        ├─► localStorage: saveOverride(tema, { status, estadoSheet })
        │   (cambio visible inmediatamente en UI con badge ~local)
        │
        └─► POST /api/update { tema, estado: "Según lo planificado" }
                │
                └─► Fichero JSON en Google Drive (QUEUE_FOLDER_ID)
                            │
                            └─► Google Apps Script (trigger por tiempo o carpeta)
                                        │
                                        └─► Aplica cambio en Google Sheet
                                            (puede tardar minutos)
```

---

## Propietarios reconocidos

El sistema reconoce y asigna color a cuatro propietarios fijos:

| Nombre | Color |
|---|---|
| Juan Rodriguez Peisel | Azul `#2563eb` |
| Francisco Toledo | Morado `#7c3aed` |
| Nacho Cruz | Ámbar `#d97706` |
| Maria Garcia | Cian `#0891b2` |

Cualquier propietario no reconocido se muestra en gris.

---

## Posibles automatizaciones

Con esta arquitectura, los siguientes flujos son automatizables sin cambiar la aplicación:

1. **Actualizar estado de un tema desde n8n / Make / Zapier:**
   ```
   POST https://<tu-dominio>.vercel.app/api/update
   Content-Type: application/json
   { "tema": "Nombre exacto del tema", "estado": "Hecho" }
   ```

2. **Leer el estado actual del tablero:**
   ```
   GET https://<tu-dominio>.vercel.app/api/data
   → devuelve todos los datos del Sheet en bruto
   ```

3. **Generar un reporte vía API de Claude directamente** (usando el proxy `/api/claude`) con los datos extraídos de `/api/data`.

4. **Añadir temas en masa** mediante un script que haga múltiples POST a `/api/update` con `action: upsert` y los campos del tema.

5. **Alertas automáticas de temas vencidos**: leer `/api/data`, parsear las fechas, filtrar los que tienen `fechaFin < hoy` y `estado != Hecho`, y notificar por email o Teams.

---

*Generado el 13 de junio de 2026. Para actualizaciones contactar con Juan Rodriguez Peisel.*
