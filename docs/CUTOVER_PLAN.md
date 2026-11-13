# OpsBoard — Plan de cutover (legacy → modelo PM)

Estado de partida (verificado en remoto): `items` 51 = `work_items` 51, `proyectos` 28 = `projects` 28, 0 filas huérfanas, 0 cambios desde la migración. La app lee y escribe solo en las tablas legacy. `plan_accion` y `campanas` quedan fuera.

**Principio:** una sola fuente activa en cada momento, sin dual-write. El cutover es un interruptor, con ensayo previo y vuelta atrás probada.

## 1. Diseño

**Interruptor `VITE_DATA_BACKEND` = `legacy` (por defecto) | `pm`.** `src/lib/api/index.js` elige la implementación. El código actual pasa a `api/legacy/` sin cambios y se añade `api/pm/` con las mismas funciones y el mismo formato de objetos, por lo que `App.jsx` no cambia. Es una variable de build: cambiarla exige un redeploy (~1 min), y eso es también la vuelta atrás.

**Adaptador `pm`** (devuelve objetos con la forma legacy):

| App | Modelo nuevo |
|---|---|
| `id` | `legacy_id` si existe, si no `id` (uuid). Mapa id→uuid en memoria para las escrituras |
| `status` (5 valores) | `status_id` ↔ planned / in_progress / blocked / done / backlog |
| `prioridad` P0–P3 | `priority` urgent / high / medium / low |
| `propietario` (texto) | `assignee_id` ↔ `people.name` |
| `proyecto` (nombre) | `project_id` ↔ `projects.name` (normalizado) |
| `category` | `tags[0]` |
| `fechaInicio/Fin` (Date) | `start_date/due_date` (DATE) |
| `objetivo`, `notas`, `archivos`, `estadoSheet`, `subtareas` | `description`, `notes`, `legacy.archivos`, `legacy.estado_sheet`, `legacy_subtareas` |
| hitos | `work_items` tipo `milestone` |
| comentarios de proyecto | `comments.project_id` |

## 2. Fases y puertas

| Fase | Contenido | Toca remoto | Puerta |
|---|---|---|---|
| **C0** | Decisiones D1–D5 (abajo) | No | Tu respuesta |
| **C1** | Script de sincronización F1D (`legacy → pm`): modo simulación, modo aplicar y **sentido inverso** (`pm → legacy`) para el rollback. Pruebas en local con PGlite | No | Tests en verde |
| **C2** | Implementación `api/pm/` + interruptor. Pruebas con un cliente Supabase simulado, y comprobación de que cada pantalla recibe los mismos objetos que con legacy (los 51 items y 28 proyectos) | No | Tests en verde y mismo resultado que legacy |
| **C3** | Preview de Vercel con `VITE_DATA_BACKEND=pm` solo en Preview. Prueba de lectura en todas las vistas y de escritura con filas `[TEST-CUTOVER]` que se limpian después. Producción sigue en legacy | Sí (variable de Preview, filas de prueba en tablas nuevas) | Tu autorización para subir la rama y crear la variable |
| **C4** | Ventana de cutover (~15 min, avisada): congelar legacy → sync final → validar → desplegar con `pm` → prueba de humo | Sí (producción) | Autorización explícita en ese momento |
| **C5** | Una semana de observación con legacy en solo lectura. Después: backup final y retirada de legacy, como fase aparte | Sí | Tu decisión |

## 3. Runbook C4 (ventana)

1. **Backup** completo de legacy y de las tablas nuevas (export local).
2. **Congelar legacy:** sustituir la política `public_all` de `items`, `proyectos`, `hitos` y `comentarios` por una de solo lectura. A partir de aquí cualquier escritura de la versión antigua falla de forma visible y no se pierde nada en silencio.
3. **Sync final** (aplicar) y **validación C** (26 checks, esperado: 0 FAIL, mismos recuentos que legacy).
4. **Desplegar** con `VITE_DATA_BACKEND=pm` (variable de Production + redeploy).
5. **Prueba de humo** (checklist en C3) con una fila `[TEST-CUTOVER]`, que se borra.
6. Avisar al equipo: **recargar la página con Ctrl+F5**.

**Vuelta atrás:** `VITE_DATA_BACKEND=legacy` + redeploy, restaurar la política de escritura de legacy, y ejecutar el sync inverso para llevar a legacy lo editado en `pm` durante la ventana. Se ensaya en C1/C3. Límite: lo que solo existe en el modelo nuevo (nuevos tipos de item, relaciones, checklists, comentarios nuevos) no vuelve a legacy, por lo que el rollback es fiable en las primeras horas y se degrada con el uso.

## 4. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `bin/process-intake.js` (CLI) lee y **escribe `items` directamente** con la clave anon: es un segundo escritor fuera de la app | Con legacy congelado falla de forma segura. Hay que migrarlo a la capa `pm` (decisión D3) |
| Pestañas con el bundle antiguo tras el despliegue | Legacy en solo lectura da error visible al escribir; aviso para recargar |
| Fechas: legacy guarda instantes (medianoche local) y el modelo nuevo guarda DATE; `fdStr` usa `toISOString()` | Test de ida y vuelta: para los 51 items, lo que muestra la UI con `pm` debe ser idéntico a legacy. Puerta de C2 |
| `propietario` es texto libre en la UI y `people` tiene 4 personas | Decisión D1 |
| Claves de localStorage por id o título (`obs-done-ts-<id>`, comentarios por título) | Con `id = legacy_id` los 18 `done` conservan su clave. Los items nuevos usan uuid |
| Tiempo real: ni `items` ni `work_items` están en la publicación `supabase_realtime` (verificado), así que hoy no funciona | No es una regresión. Opcional: añadir `work_items` a la publicación en C4 (decisión D5) |
| Overrides locales de proyecto (`obs-proy-overrides`) siguen aplicándose por encima en la UI | Sin cambios; ninguna captura contiene ediciones de proyecto |
| Errores existentes (`onUnifyTema` con `setAllItems` inexistente; comentarios de proyecto con `eq(..., null)`) | `pm` usa `project_id`, lo que arregla el segundo. El primero se corrige aparte |

## 5. Decisiones que necesito

- **D1 — Propietarios nuevos:** si alguien escribe en la UI un nombre que no está en `people`: (a) crear la persona automáticamente *(recomendado)*, (b) dejar el campo vacío y avisar.
- **D2 — Histórico:** los 18 items `done` siguen sin `completed_at`. Recomiendo mantener el comportamiento actual (el Histórico usa el `done_ts` local como ahora) y que los nuevos pasos a Done usen `completed_at`.
- **D3 — `bin/process-intake.js`:** (a) portarlo a la capa `pm` en C2 *(recomendado)*, (b) dejarlo fuera de servicio tras el cutover.
- **D4 — Vista previa:** ¿autorizas subir la rama `feat/pm-data-model-f1` a GitHub para generar el preview de Vercel en C3? (Es publicar código: lo pregunto cuando toque.)
- **D5 — Tiempo real:** ¿añadimos `work_items` a `supabase_realtime`? *(recomendado, restaura lo que la app pretende hacer)*.

## 6. Lo que no se hace en este plan
Auth y permisos, vistas nuevas (Board, My Work, Portfolio), `plan_accion`, fusión de proyectos duplicados y borrado de tablas legacy.

---

## 7. Estado de C1 y C2 (hecho en local, sin tocar remoto)

**C1 — sincronización.** `supabase/migrations/20261111120000_f1d_sync.sql` (copia lista para el SQL Editor en `scripts/migration/remote/D_sync_f1d.sql`). Solo crea funciones:
- `f1d_sync(false|true)`: legacy → pm. Con `false` solo lista los cambios pendientes (insertar, actualizar, borrar, saltar filas inválidas). No fabrica `completed_at`. Crea las personas nuevas (D1). Registra en `activity_events`.
- `f1d_reverse(false|true)`: pm → legacy, solo para el rollback. Crea en legacy los items nativos del modelo nuevo.
- Pruebas (`scripts/migration/test-f1d.mjs`, 20/20): con los datos reales, ambas funciones están vacías justo después de F1B (los mapeos son simétricos); cubren altas, ediciones, borrados, filas inválidas, personas nuevas, hitos y comentarios, e idempotencia.

**C2 — backend `pm`.** `src/lib/api/` queda así: `index.js` (interruptor `VITE_DATA_BACKEND`), `legacy/` (código actual sin cambios) y `pm/` (nuevo). `App.jsx` no cambia.
- Pruebas (`scripts/migration/test-pm-backend.mjs`, 24/24) con un cliente Supabase simulado y los 51 items y 28 proyectos reales: mismos ids y mismos campos que legacy; escrituras (estado, propietario nuevo, proyecto, subtareas, alta, borrado, fusión, hitos, comentarios, proyectos); tiempo real.
- Comprobación en el navegador, solo lectura, build `pm` contra la BD real: Dashboard, Tablero, Proyectos, Reporte, Histórico y Campañas cargan sin errores y con los mismos 51 temas.

### Hallazgos de C2 que requieren tu decisión

**D6 — Fechas.** La UI muestra muchas fechas un día antes del día real. Legacy guarda medianoche de Madrid (22:00 o 23:00 UTC) y la UI las muestra con `toISOString().slice(0,10)`, que da el día anterior. En los datos reales, 40 de 58 valores caen en ese caso. Con el backend `pm` esas fechas se muestran correctas (el día de Madrid, el mismo que aprobaste para la migración). Efecto visible: en las pantallas que usan ese formato, unas 40 fechas pasan a mostrarse un día más tarde, y los contadores de "días vencido" bajan un día (por ejemplo, "Actualizar tarifarios VF": 16/04 → 17/04). Las pantallas que ya usaban el día local no cambian. *Recomendación: aceptar, porque corrige un error existente.*

**Orden de filas con el mismo `created_at`.** Muchos items se crearon en el mismo instante, y el orden entre ellos nunca fue estable en legacy. En `pm` es determinista (`created_at` descendente y después `number`), lo que puede reordenar esos empates. El contenido es el mismo.

**Nuevos items.** Los items creados desde la app conservan su id de la app como `legacy_id` (tipo `topic`), así sus claves en localStorage y la fusión con el rollback siguen funcionando.

**Lo que sigue pendiente:** C3 (preview de Vercel con `pm`, que requiere subir la rama), C4 (ventana de cutover) y C5. El tiempo real (D5) se activa en C4 con `alter publication supabase_realtime add table work_items`.