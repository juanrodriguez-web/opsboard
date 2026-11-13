# Runbook C4 — cutover de producción a `pm`

Estado: **preparado y ensayado en local, no ejecutado.** Cada paso de producción espera tu "go" explícito.
Proyecto Supabase: `qmgmvtjnbarqonrfmpix` (OpsBoard, **no** "Portal de proyectos SERCOM"). Proyecto Vercel: `opsboard`.

## Antes de la ventana (sin impacto para el equipo)

| # | Paso | Quién | Impacto |
|---|---|---|---|
| P1 | Pegar `scripts/migration/remote/D_sync_f1d.sql` en el SQL Editor. Solo crea funciones | Tú | Ninguno |
| P2 | Ejecutar `cutover/00_preflight.sql`. Esperado: `f1d_functions_installed = 2`, 51/51 items, 28/28 proyectos y `f1d_sync(false)` vacío o con cambios conocidos | Tú, y me pasas el resultado | Ninguno (solo lectura) |
| P3 | Backup fresco: `node scripts/migration/export-legacy-snapshot.mjs <ruta>` | Yo | Ninguno |
| P4 | Merge de `feat/pm-data-model-f1` a `main` (PR). Despliega producción **en modo `legacy`** (comportamiento idéntico, más el arreglo de Plan de Acción). Se comprueba que la capa nueva funciona en producción antes del corte | Yo, con tu "go" | Bajo: es el mismo código con el interruptor apagado |
| P5 | Avisar al equipo del día y hora de la ventana (15 min) y de que tendrán que recargar con Ctrl+F5 | Tú | — |

## Ventana (≈15 min, nadie debe editar)

| # | Paso | Archivo / acción | Si falla |
|---|---|---|---|
| 1 | Congelar legacy (solo lectura) | `cutover/10_freeze_legacy.sql` | Reabrir con el bloque 3 de `90_rollback.sql` |
| 2 | Sync final: simulación y aplicar | `cutover/20_final_sync.sql` | Parar y revisar el resultado |
| 3 | Validar | `remote/C_validar.sql` → **0 FAIL** | No seguir. Rollback |
| 4 | Tiempo real (D5) | `cutover/30_realtime.sql` | No bloquea. Se puede omitir |
| 5 | Vercel: crear `VITE_DATA_BACKEND=pm` en **Production** y redesplegar | Yo, con tu "go" | Rollback |
| 6 | Prueba de humo en producción: carga, crear/editar/borrar un `[TEST-CUTOVER]`, comprobar `work_items`, limpiar | Yo | Rollback |
| 7 | Avisar al equipo: recargar con Ctrl+F5 | Tú | — |

## Rollback (cualquier momento)

1. Vercel: `VITE_DATA_BACKEND=legacy` (o borrar la variable) y redesplegar producción.
2. `cutover/90_rollback.sql`: bloque 1 (simulación), bloque 2 (`f1d_reverse(true)`, lleva lo editado en `pm` a legacy) y bloque 3 (reabrir escritura).
3. Límite: lo que solo existe en el modelo nuevo (relaciones, checklists, nuevos tipos) no vuelve a legacy.

## Ensayo en local

`scripts/migration/test-cutover-rehearsal.mjs` ejecuta esta secuencia con tus datos reales y un rol `anon`: antes del congelado el equipo escribe, tras congelar las escrituras fallan (insert rechazado por RLS; update y delete afectan 0 filas), el sync final deja 0 pendientes, la validación da 0 FAIL, el tiempo real es idempotente y el rollback devuelve a legacy lo editado en `pm` y reabre la escritura. 16 comprobaciones en verde. En el ensayo se encontró y corrigió un fallo de `f1d_reverse`: la simulación no listaba los items creados en `pm` que ya tenían id.

## Después del cutover

- **Una semana de observación** con legacy en solo lectura.
- **`bin/process-intake.js`** (CLI) sigue apuntando a legacy: con legacy congelado falla de forma segura. Hay que portarlo a la capa `pm` (decisión D3), tarea aparte tras el cutover.
- Retirada de las tablas legacy: fase C5, con backup final y decisión tuya.
