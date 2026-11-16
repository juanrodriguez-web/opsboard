# OpsBoard: acceso con login (Supabase Auth)

Decisiones (16/11/2026): enlace por email; entra solo quien tenga su email en `people`; todos ven y editan todo (roles, más adelante);
los automatismos entran por un endpoint de ingesta con token.

## Qué hay en el repo (nada activo todavía)
- `src/lib/auth.js` y `src/AuthGate.jsx`: pantalla de acceso. **Solo se activa con `VITE_REQUIRE_AUTH=true`** en Vercel; sin esa variable la app funciona como hoy.
- `supabase/migrations/20261116200000_auth_rls.sql`: cierra la base de datos a usuarios con sesión cuyo email esté en `people`. **No ejecutar hasta el paso 6.**
- `supabase/migrations/20261116200001_auth_rls_rollback.sql`: vuelve a abrirlo todo (si alguien se queda fuera).
- `supabase/functions/mail-ingest/index.ts`: única puerta para `/backlog-mail` cuando la base ya esté cerrada (token propio; solo lee lo mínimo y solo inserta en `mail_candidates`).
- `scripts/mail-ingest.mjs`: usa el endpoint si existen `INGEST_URL` e `INGEST_TOKEN`; si no, el modo directo de hoy.

## Orden de despliegue (cada paso se puede deshacer)
Cambio del 16/11: **email + contraseña sin enviar correos** (el SMTP no sirvió para el portal del empleado). Los usuarios los crea el administrador.
1. **Supabase -> Authentication -> Sign In / Providers:** dejar el proveedor Email activo y **desactivar «Allow new users to sign up»** (si no, quien se registre con el email de otra persona entraría como ella).
2. **Supabase -> Authentication -> Users -> Add user -> Create new user:** email, contraseña y marcar **Auto Confirm User**, uno por persona de `people` (Juan Rodriguez Peisel y Francisco Toledo). No se envía ningun correo.
3. **Emails en `people`:** deben coincidir exactamente con los de Authentication. Cualquier persona nueva: fila en `people` + usuario en Authentication.
4. **Endpoint de ingesta:** desplegar la funcion con `verify_jwt` desactivado, crear el secreto `INGEST_TOKEN` (largo y aleatorio) y probar `context` e `insert`. Guardar `INGEST_URL` e `INGEST_TOKEN` en las tareas programadas de Backlog Mail en lugar de la clave publica.
5. **Activar el login:** `VITE_REQUIRE_AUTH=true` en Vercel (Produccion) y redeploy. Probar con Juan y con Francisco (boton 🔑 para cambiar la contraseña). La base aun esta abierta: sirve para comprobar el flujo sin riesgo.
6. **Cerrar la base:** ejecutar `20261116200000_auth_rls.sql` en el SQL Editor. Comprobar: con sesion todo funciona; con la clave publica sin sesion, cero filas. Si algo falla: rollback.
7. **Retirar la clave publica de los scripts** (`bin/process-intake.js` y cualquier otro uso directo) y quitar el modo directo de `mail-ingest.mjs`.

## Riesgos conocidos
- Quien no esté en `people` verá «Sin acceso» aunque reciba el enlace (la base no le devuelve nada).
- El CLI `bin/process-intake.js` usa la clave pública: dejará de funcionar tras el paso 6 hasta que tenga su propio acceso.
- Al cerrar la base, el tiempo real exige sesión; si caduca, la app pide entrar de nuevo.
- Los comentarios y las vistas guardadas siguen sin autor obligatorio; los roles llegan en una segunda fase.
