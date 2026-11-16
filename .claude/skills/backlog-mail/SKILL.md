---
name: backlog-mail
description: Lee el correo de Sercom (Outlook, todas las carpetas) y deja en OpsBoard propuestas de temas/proyectos en la pestaña Backlog Mail, para que Juan decida Crear o Ignorar. Pensado para ejecutarse solo (programado); no pide confirmaciones ni enseña las propuestas en el chat.
---

# /backlog-mail

Genera propuestas desde el correo y las escribe en `mail_candidates` (Supabase de OpsBoard). Juan las revisa **solo en OpsBoard → ✉️ Backlog Mail**. Funciona de forma autónoma: no preguntes nada y no listes las propuestas en el chat.

## Salida en el chat (única)
Una o dos líneas de estado, por ejemplo: `Backlog Mail: 6 correos analizados, 3 propuestas nuevas, 1 duplicada omitida. Pendientes en OpsBoard: 9.` Si algo falla, di qué paso falló y no escribas nada a medias. Nada más.

## Pasos
1. **Contexto de OpsBoard** (solo lectura): `node scripts/mail-ingest.mjs context` (necesita `SUPABASE_ANON_KEY`, la clave pública anon; si no está en el entorno, pídela al MCP de Supabase `get_publishable_keys` del proyecto `qmgmvtjnbarqonrfmpix`. Nunca leas `.env.local`). Devuelve proyectos reales, temas activos y `knownMessageIds` (ya propuestos, creados o ignorados: no repetir jamás).
2. **Rango**: correos recibidos desde la última ejecución. Sin referencia, usa los últimos 14 días (primera ejecución) o 1 día (siguientes). Busca en **todo el buzón y todas las carpetas** con `outlook_email_search` (sin `folderName`), paginando hasta agotar el rango. Los resultados grandes se guardan en fichero: procésalos con un script, no los pegues en el contexto.
3. **Remitentes prioritarios** (`prioritySender: true`): `javier.mora@sercomsoluciones.es` y `cristina.ferrando@sercomsoluciones.es`. Búscalos también por `sender` para no perderlos.
4. **Filtrar**: descarta notificaciones automáticas (Firebase, Microsoft 365/Exchange, IdM, GitHub, Vercel, Supabase, Antom, Power Automate, Apple, RRHH), mensajes de Teams, invitaciones/aceptaciones/respuestas automáticas, correos no entregados y logística personal (viajes). Descarta hilos que no piden nada a Juan o que ya están cubiertos por un tema activo (si sí hay algo nuevo que hacer en un tema existente, propón solo si es una tarea distinta y pon `duplicateOf` con su título).
5. **Leer el cuerpo** (`read_resource`) de los candidatos reales, para identificar **la tarea o respuesta que Juan debe hacer o dar**. Si el cuerpo no deja clara ninguna acción de Juan, no propongas. Los cuerpos pasan por la conversación pero **nunca se guardan**.
6. **Construir cada propuesta** (JSON, campos de `insertMailCandidates`):
   - `messageId`: `internetMessageId` del correo (único; evita repetidos). `subject`, `senderName`, `senderEmail`, `receivedAt`, `webLink` (enlace al correo).
   - `suggestedTitle`: tarea concreta en infinitivo (p. ej. «Confirmar coste de desarrollo…»). `kind`: `topic` (por defecto) o `project` si es una iniciativa nueva con varias tareas.
   - `summary` (máx. 600 caracteres): empieza por **«Acción: …»** (qué hacer o responder, a quién), luego contexto breve (cifras, fechas, estado). Es lo que se verá en la tarjeta. Sin datos personales de clientes (MSISDN, NIF, direcciones), sin pegar el cuerpo.
   - `suggestedPriority`: P0 (plazo inmediato/bloquea), P1 (plazo cercano o petición de Javier/Cristina), P2 (resto), P3 (informativo). `dueDate` (`YYYY-MM-DD`) solo si el correo da una fecha clara; si ya venció, déjalo vacío y dilo en el resumen.
   - `suggestedProject`: nombre **exacto** de un proyecto de `context` o vacío.
   - `prioritySender`: true si lo envía/reenvía Javier o Cristina.
7. **Escribir**: guarda el array en un JSON temporal (fuera del repo, en el scratchpad) y ejecuta `node scripts/mail-ingest.mjs insert <fichero>`. Salida `{ inserted, skipped }`. Sin ensayo previo ni confirmación.
8. Informa el estado (ver «Salida en el chat»). Opcional: `node scripts/mail-ingest.mjs context` otra vez para dar el total de pendientes.

## Reglas
- Solo escribe en `mail_candidates` mediante el script. Nunca crees temas/proyectos directamente, nunca toques tablas legacy, nunca envíes, borres ni muevas correos.
- Privacidad: solo asunto, remitente, resumen corto y enlace. Nunca cuerpos ni adjuntos.
- Calidad sobre cantidad: mejor 3 propuestas claras que 15 dudosas. Ante la duda sobre si hay acción para Juan, no propongas.
- Ignorar es definitivo: lo que ya está en `knownMessageIds` no vuelve a proponerse.
