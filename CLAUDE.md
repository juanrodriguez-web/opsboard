# OpsBoard — Contexto del proyecto

## Qué es esto

Dashboard interno de operaciones para gestionar temas/tareas de un equipo pequeño. SPA en React 18 + Vite, desplegada en Vercel. Base de datos Supabase.

- **Producción:** https://opsboard-phi-ten.vercel.app (proyecto Vercel `opsboard`, equipo `sercom2`). Alias equivalentes: `opsboard-sercom2.vercel.app`, `opsboard-git-main-sercom2.vercel.app`.
- **`opsboard-wheat.vercel.app` está obsoleta:** es una versión antigua, fuera del proyecto actual. Sigue leyendo las tablas legacy y **no puede guardar** (están en solo lectura). No usarla.
- **Repo:** https://github.com/juanrodriguez-web/opsboard
- **Supabase:** proyecto de OpsBoard `qmgmvtjnbarqonrfmpix` (ojo: existe otro, "Portal de proyectos SERCOM", que NO es este).

---

## Estado actual (cutover del 13 nov 2026)

La app **lee y escribe en el modelo PM nuevo** (`work_items`, `projects`, `people`, `statuses`, `comments`). Las tablas legacy (`items`, `proyectos`, `hitos`, `comentarios`) están **congeladas en solo lectura** (política `legacy_read_only`) y se conservan como respaldo. `campanas` y `plan_accion` siguen en sus tablas originales.

- El interruptor es `VITE_DATA_BACKEND` (`pm` en Producción; sin la variable o `legacy` = tablas antiguas). Una sola fuente activa, **sin dual-write**.
- Rollback: `VITE_DATA_BACKEND=legacy` + redeploy + `scripts/migration/cutover/90_rollback.sql` (lleva a legacy lo editado en `pm` y reabre la escritura). Detalle en `docs/CUTOVER_RUNBOOK.md`.
- Pendiente: una semana de observación y después retirar legacy (backup final antes; decisión del propietario del proyecto).

---

## Stack

- **Frontend**: React 18 + Vite, `src/App.jsx` (~4270 líneas: componentes, lógica, estilos inline)
- **Capa de datos**: `src/lib/api/` (ningún componente debe usar el cliente Supabase directamente)
- **Base de datos**: Supabase (PostgreSQL)
- **Deploy**: Vercel (auto-deploy desde `main`; una variable de entorno nueva exige redeploy)
- **Notificaciones email**: Resend via `api/notify.js` (RESEND_API_KEY pendiente de configurar en Vercel)
- **Sin router**: SPA de una sola página, navegación por estado React

---

## Estructura de archivos

```
src/
  App.jsx              ← Frontend (componentes, lógica, estilos inline)
  main.jsx             ← Punto de entrada React
  parser.js            ← Parsers de Google Sheets (legacy) + norm()
  lib/
    supabase.js        ← Cliente Supabase (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
    api/
      index.js         ← Elige backend según VITE_DATA_BACKEND y exporta la API
      legacy/          ← Backend sobre items/proyectos/hitos/comentarios
      pm/              ← Backend sobre work_items/projects/people/comments (adaptador: devuelve los objetos que usa la UI)
      util.js

api/                   ← Serverless de Vercel (notify, claude, data, append, update)
bin/process-intake.js  ← CLI: lee la carpeta de intake, analiza con Claude y actualiza temas (usa la capa pm)

supabase/migrations/   ← Migraciones versionadas del modelo PM (F1A–F1D)
supabase-schema.sql    ← Schema del modelo legacy (original)
scripts/migration/     ← Auditoría, migración, reconciliación, cutover y tests (ver abajo)
docs/                  ← CUTOVER_PLAN.md, CUTOVER_RUNBOOK.md
```

---

## Variables de entorno

En Vercel (Settings → Environment Variables):

| Variable | Descripción |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase (Production y Preview) |
| `VITE_SUPABASE_ANON_KEY` | Anon key pública de Supabase (Production y Preview) |
| `VITE_DATA_BACKEND` | `pm` en Production. También existe, solo para la rama `feat/pm-data-model-f1`, en Preview |
| `RESEND_API_KEY` | **Pendiente** — necesaria para alertas por email |

Las variables `VITE_*` se embeben en el bundle en build time. **Cuidado:** un `.env.production` descargado con `vercel env pull` trae las `VITE_*` vacías y anula a `.env.local`; para un build local, pasarlas por entorno.

---

## Base de datos (Supabase)

### Modelo PM (activo)

`people` (name, email, role, capacity_h nullable, auth_user_id nullable) · `projects` (name, owner_id, status, health, priority, start_date, target_date, fase, capex, desarrollo, legacy_id…) · `statuses` (7 globales: Backlog, Planned, In Progress, Blocked, Review, Done, Cancelled; con categoría NOT_STARTED/ACTIVE/DONE/CANCELLED) · `work_items` (type task|topic|milestone|issue|risk|decision, project_id nullable, title, status_id, priority, assignee_id, start_date/due_date como `DATE`, tags, risk, `legacy_id`, `legacy_subtareas`, `legacy` jsonb, completed_at…) · `work_item_relations` (una fila `blocks(A,B)`) · `comments` · `activity_events` · `work_item_checklists`/`checklist_items` (sin UI aún).

- Los temas de la app son `work_items` de tipo `topic`; `legacy_id` conserva el id que usa la app. Los hitos son `work_items` de tipo `milestone`.
- `completed_at` lo rellena un trigger al pasar a una categoría DONE. **No** se rellena desde `obs-done-ts-*` (el app fabricaba esas marcas).
- Las fechas se guardan como `DATE`; el día de referencia es el de Europe/Madrid.
- Un propietario nuevo escrito en la UI crea la persona en `people`.
- Las funciones `f1d_sync(apply)` (legacy→pm) y `f1d_reverse(apply)` (pm→legacy, solo rollback) están instaladas; son simulación por defecto.

### Tablas legacy (congeladas, solo lectura)

`items`, `proyectos`, `hitos`, `comentarios`. Siguen siendo el respaldo del rollback. `campanas` y `plan_accion` siguen activas en su tabla original (`plan_accion` solo se lee; su migración está pendiente y debe hacerse desde el Excel vigente, no desde esa tabla).

### Mapping DB → App

La DB usa snake_case, el frontend camelCase. El adaptador `src/lib/api/pm/mappers.js` convierte filas PM en los objetos de la UI (`workToItem`, `projectToApp`…): estados legacy `pending|inprogress|blocked|done|backlog` ↔ `planned|in_progress|blocked|done|backlog`; prioridades P0–P3 ↔ urgent/high/medium/low. Las fechas se entregan como `Date` a mediodía local.

**RLS**: política abierta `public_all` en las tablas nuevas (sin Auth, protegidas solo por la URL del proyecto). Auth y permisos por rol están fuera de alcance por ahora.

---

## Constantes clave en App.jsx

```js
const CATS = ['projects','product','tools','cvm']
const ST = [ pending 'Pendiente', inprogress 'En Curso', blocked 'Bloqueado', done 'Completado', backlog 'Backlog' ]  // backlog: sección propia
const FASES = ['RTM','Viabilidad','Business case','Comité de capex','Desarrollo']
const KNOWN_OWNERS = ['Juan Rodriguez Peisel','Francisco Toledo','Nacho Cruz','Maria Garcia']
```

---

## Componentes principales (todos en App.jsx)

`App` (estado global, carga, tiempo real) · `Tablero` · `Tarjeta` · `ModalItem` · `TableroKPIStrip` · `Proyectos` · `ProjectDetailView` (detalle/edición de proyecto, hitos y comentarios) · `Dashboard` · `Cristina` (Reporte Semanal, ES/EN) · `CampanasCVM` · `PlanAccion` · `IAIntake` · `Historico`.

---

## Flujo de datos

1. **Carga inicial:** `loadAll()` de `src/lib/api` (items, proyectos, campañas).
2. **Escritura:** `onItemChange(id, fields)` → `updateItem()`; altas con `insertItems()`; borrado con `deleteItem()` (el Reporte pide confirmación antes de borrar).
3. **Tiempo real:** `subscribeToItems()` escucha `work_items` (añadida a la publicación `supabase_realtime`).
4. **Botón "Migrar Sheets → Supabase"** (solo aparece con 0 items o proyectos): escribe vía la capa activa; ya no debería hacer falta.

---

## Migración y tests (`scripts/migration/`)

Probados en local con Postgres en memoria (`npm i --no-save @electric-sql/pglite`):

| Comando | Qué comprueba |
|---|---|
| `node scripts/migration/test-f1d.mjs <snapshot.json>` | Sincronización legacy↔pm |
| `node scripts/migration/test-pm-backend.mjs <snapshot.json>` | Backend `pm` contra los datos migrados |
| `node scripts/migration/test-cutover-rehearsal.mjs <snapshot.json>` | Ensayo completo del runbook de cutover |
| `node scripts/migration/run-f1c.mjs` / `run-local.mjs` | Reconciliación de localStorage y migración de datos (fixtures) |
| `node scripts/migration/test-process-intake.cjs` | Capa de datos de `bin/process-intake.js` |
| `node scripts/migration/export-legacy-snapshot.mjs <salida.json>` | Copia de solo lectura de las tablas legacy (guardar fuera del repo) |

Los SQL para el editor de Supabase están en `scripts/migration/remote/` (A–D) y `scripts/migration/cutover/`.

---

## Pendientes conocidos

- [ ] **RESEND_API_KEY** no configurada en Vercel → las alertas de email no funcionan
- [ ] **Campañas CVM** — tabla vacía, no hay UI para crear campañas
- [ ] **Botón de migración Sheets** — retirar
- [ ] **Histórico de proyectos** — no existe (solo para items)
- [ ] **`plan_accion`** — migrar desde el Excel vigente (la tabla actual perdió datos en su import original)
- [ ] **Proyectos duplicados** sin resolver (se mantienen separados): GAMIFICACIÓN / Gamificación y comunidad; Mejora comunicación CDV / BPMOC217 - Mejora comunicación CDV Prepago; Evolución/Mejoras e-SIM Prepago / MEJORA WEB ESIM PREPAGO
- [ ] **Retirada de legacy** tras una semana de observación (backup final antes)
- [ ] **Sin probar en producción:** crear/editar proyectos, hitos y comentarios; tiempo real con dos pestañas
- [ ] Dato sospechoso: la fecha de fin de BPMOC264 es 05/06/**2024**
- [ ] Fuera de alcance por ahora: Auth/permisos, vistas nuevas (Board, My Work, Portfolio), Workload

---

## Cómo desarrollar

```bash
npm install
npm run dev          # Vite dev server (necesita .env.local con las VITE_ vars)
npm run build        # Genera dist/
git push origin main # Vercel auto-deploya desde main
```

`.env.local` para desarrollo: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y, para probar el modelo nuevo, `VITE_DATA_BACKEND=pm`.

---

## Gotchas importantes

- **OneDrive + git**: el repo está en una carpeta sincronizada por OneDrive. Usar PowerShell en Windows para git; encadenar con `;` en vez de `&&`.
- **Nunca escribir en las tablas legacy**: están congeladas. Cualquier script o CLI debe usar la capa `src/lib/api/pm`.
- **Ramas de preview**: `feat/pm-data-model-f1` tiene su variable `VITE_DATA_BACKEND=pm` solo en Preview. Los previews están protegidos con login de Vercel.
- **Fechas**: la UI formatea con `toISOString().slice(0,10)`; un `Date` a medianoche de Madrid se vería un día antes. Por eso el adaptador entrega mediodía local.
- **Backlog**: los items con `status:'backlog'` salen del kanban y van a la sección colapsable; ⊟ los mueve al backlog y "Activar" los devuelve a un estado.
- **Traducción**: el Reporte usa claves `ES`/`EN` en mayúsculas; el menú lateral no se traduce.
- **localStorage del navegador** (no migrado a la BD): `obs-proy-overrides` (ediciones de proyecto antiguas, superpuestas en la UI), `obs-comments`, `obs-done-ts-*` (marcas del Histórico). Se perdió deliberadamente cualquier dato que solo existiera ahí.
- **App.jsx monolítico**: si crece mucho más, partir en componentes.
