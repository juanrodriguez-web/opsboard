# OpsBoard — Contexto del proyecto

## Qué es esto

Dashboard interno de operaciones para gestionar temas/tareas de un equipo pequeño. SPA en React 18 + Vite, desplegada en Vercel. Base de datos Supabase (reemplazó Google Sheets en junio 2025). Repo: https://github.com/Juangas50/opsboard — Deploy: https://opsboard-wheat.vercel.app

---

## Stack

- **Frontend**: React 18 + Vite, todo en un solo archivo `src/App.jsx` (~2950 líneas)
- **Base de datos**: Supabase (PostgreSQL) con realtime via `postgres_changes`
- **Deploy**: Vercel (auto-deploy desde `main`)
- **Notificaciones email**: Resend via `api/notify.js` (RESEND_API_KEY pendiente de configurar en Vercel)
- **Sin router**: SPA de una sola página, navegación por estado React

---

## Estructura de archivos

```
src/
  App.jsx          ← TODO el frontend (componentes, lógica, estilos inline)
  main.jsx         ← Punto de entrada React
  parser.js        ← Parsers de Google Sheets (legacy, aún usados para migración)
  lib/
    supabase.js    ← Cliente Supabase (usa VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)

api/
  notify.js        ← Serverless: envío de email via Resend
  claude.js        ← Serverless: integración IA (intake de temas)
  data.js          ← Legacy Google Sheets (ya no se usa activamente)
  append.js        ← Legacy Google Sheets
  update.js        ← Legacy Google Sheets

supabase-schema.sql  ← Schema completo de la DB
CLAUDE.md            ← Este archivo
```

---

## Variables de entorno

En Vercel (Settings → Environment Variables):

| Variable | Descripción |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Anon key pública de Supabase |
| `RESEND_API_KEY` | **Pendiente** — necesaria para alertas por email |

Las variables `VITE_*` se embeben en el bundle en build time. Sin ellas la app no conecta.

---

## Base de datos (Supabase)

### Tablas principales

**`items`** — Temas/tareas del tablero
```
id, tema, objetivo, category, propietario, prioridad, risk,
status, estado_sheet, fecha_inicio, fecha_fin,
archivos, notas, proyecto, subtareas (jsonb), created_at, updated_at
```

**`proyectos`** — Proyectos/iniciativas
```
id, nombre, descripcion, propietario, prioridad, estado, status,
desarrollo, fecha_inicio, fecha_fin, notas, fase, capex, nombre_en,
created_at, updated_at
```

**`comentarios`** — Comentarios por item
```
id, item_id (fk→items), texto, ts, created_at
```

**`campanas`** — Campañas CVM
```
id, nombre, estado, fecha_inicio, fecha_fin, notas, created_at
```

### Mapping DB → App

La DB usa snake_case, el frontend usa camelCase. Las funciones de mapping son:

```js
// En App.jsx
function dbToItem(row) { /* fecha_inicio→fechaInicio, etc. */ }
function dbToProy(row) { /* fecha_inicio→fechaInicio, estado→status, etc. */ }
```

**RLS**: Todo público (protegido solo por URL del proyecto Supabase). Política `public_all` en todas las tablas.

---

## Constantes clave en App.jsx

```js
// Categorías de items
const CATS = ['projects','product','tools','cvm']

// Estados del kanban
const ST = [
  { id:'pending',    label:'Pendiente'  },
  { id:'inprogress', label:'En Curso'   },
  { id:'blocked',    label:'Bloqueado'  },
  { id:'done',       label:'Completado' },
  { id:'backlog',    label:'Backlog'    },  // ← fuera del kanban, sección propia debajo
]

// Límites WIP — todos null (sin límite)
const WIP_LIMITS = { pending:null, inprogress:null, blocked:null, done:null, backlog:null }

// Colores de la app
const C = { bg, surface, card, border, text, muted, accent:'#e8243b' }

// Fases de proyecto
const FASES = ['RTM','Viabilidad','Business case','Comité de capex','Desarrollo']

// Propietarios conocidos
const KNOWN_OWNERS = ['Juan Rodriguez Peisel','Francisco Toledo','Nacho Cruz','Maria Garcia']
```

---

## Componentes principales (todos en App.jsx)

| Componente | Qué hace |
|---|---|
| `App` | Raíz: estado global, subscripciones Supabase, navegación entre vistas |
| `Tablero` | Vista kanban + lista + sección backlog + filtros |
| `Tarjeta` | Card individual en kanban (botón ⊟ para backlog, → para avanzar estado) |
| `ModalItem` | Modal de detalle/edición de un tema (subtareas, comentarios, fechas) |
| `TableroKPIStrip` | Strip de métricas rápidas sobre el kanban |
| `Proyectos` | Vista de proyectos/iniciativas con kanban propio |
| `ModalProy` | Modal de detalle de proyecto |
| `Dashboard` | Gráficos y resumen ejecutivo |
| `ReporteSemanal` | Reporte en formato presentación, con traducción ES/EN |
| `CampanasCVM` | Tabla de campañas de marketing CVM |
| `IAIntake` | Formulario con IA para crear nuevos temas |
| `Historico` | Archivo de temas completados |

---

## Flujo de datos

1. **Carga inicial**: `useEffect` en `App` → `supabase.from('items').select('*')` + `proyectos` + `campanas`
2. **Realtime**: `supabase.channel('items-changes').on('postgres_changes', ...)` actualiza estado React en tiempo real entre pestañas/usuarios
3. **Escritura**: `onItemChange(id, fields)` → `supabase.from('items').update(fields).eq('id', id)` → la subscripción realtime propaga el cambio
4. **Nuevo item**: `supabase.from('items').insert(newItem)` → aparece vía realtime
5. **Migración**: botón "Migrar Sheets → Supabase" (aparece si `items.length === 0 || proyectos.length === 0`) lee de Google Sheets via API y hace insert masivo en Supabase

---

## Pendientes conocidos

- [ ] **RESEND_API_KEY** no configurada en Vercel → las alertas de email no funcionan
- [ ] **Campañas CVM** — tabla vacía, no hay UI para crear campañas todavía
- [ ] **Botón de migración** — quitar una vez confirmado que todos los datos están en Supabase
- [ ] **Histórico de proyectos** — no existe aún (solo existe para items)

---

## Cómo desarrollar

```bash
# Instalar dependencias
npm install

# Desarrollo local (necesita .env.local con las VITE_ vars)
npm run dev          # Vite dev server en :5173 + proxy /api → :3000

# Build de producción
npm run build        # Genera dist/

# Deploy
git push origin main  # Vercel auto-deploya desde main
```

### .env.local para desarrollo
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

---

## Historial de cambios relevantes (últimos commits)

| Commit | Descripción |
|---|---|
| `1f0808b` | feat: backlog section + remove WIP limits |
| `925884f` | fix: subtareas useState en ModalItem (modal en blanco) |
| `dc5bdfe` | fix: migración proyectos + mapeo dbToProy + columnas schema |
| `8c57f4a` | fix: fetch campañas+proyectos desde Supabase, migración proyectos |
| `141e917` | feat: migración a Supabase con realtime |

---

## Gotchas importantes

- **OneDrive + git**: El repo está en una carpeta sincronizada por OneDrive. Los comandos git desde WSL/Linux pueden fallar por bloqueos NTFS. Usar siempre PowerShell en Windows para git. En PowerShell usar `;` en vez de `&&` para encadenar comandos.
- **App.jsx monolítico**: Todo el frontend está en un solo archivo. Si supera ~3000 líneas considerar partir en componentes separados.
- **VITE_ vars**: Se embeben en build time. Cambios en Vercel requieren redeploy para tener efecto.
- **Backlog**: Los items con `status:'backlog'` se excluyen del kanban y aparecen en la sección colapsable debajo. El botón ⊟ en cada tarjeta mueve al backlog; "Activar" en la sección backlog permite moverlos de vuelta a cualquier estado.
