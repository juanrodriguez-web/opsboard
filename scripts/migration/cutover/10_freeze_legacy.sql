-- C4 · 10 CONGELAR LEGACY. Deja items, proyectos, hitos y comentarios en SOLO LECTURA para la clave anon.
-- Cualquier escritura de una pestaña con la versión antigua (o de bin/process-intake.js) falla de forma visible.
-- Se deshace con 90_rollback.sql. Ejecutar en una sola pasada.
begin;
do $$ declare t text; p text; begin
  foreach t in array array['items', 'proyectos', 'hitos', 'comentarios'] loop
    foreach p in array array['public_all', 'hitos_public', 'legacy_read_only'] loop
      execute format('drop policy if exists %I on %I', p, t);
    end loop;
    execute format('alter table %I enable row level security', t);
    execute format('create policy legacy_read_only on %I for select using (true)', t);
  end loop;
end $$;
commit;
select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('items', 'proyectos', 'hitos', 'comentarios') order by 1;
