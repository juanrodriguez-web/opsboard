-- C4 · 20 SYNC FINAL legacy -> pm (con legacy ya congelado). Ejecutar DESPUÉS de 10_freeze_legacy.sql.
-- 1) Lo que va a hacer (debe ser pequeño o vacío):
select * from f1d_sync(false);
-- 2) Aplicar (descomenta y ejecuta solo este bloque cuando el paso 1 sea el esperado):
-- select * from f1d_sync(true);
-- 3) Comprobar que no queda nada pendiente (debe devolver 0 filas, o solo 'skip_invalid' ya conocidos):
-- select * from f1d_sync(false);
-- 4) Ejecutar scripts/migration/remote/C_validar.sql: esperado 0 FAIL.
