-- C4 · 00 PREFLIGHT (solo lectura). Ejecutar en el SQL Editor del proyecto de OpsBoard (ref qmgmvtjnbarqonrfmpix).
-- Esperado antes de la ventana: f1d_functions_installed = 2, items_missing_in_pm / pm_orphans / changed_since_migration = 0 (o la lista que arroje f1d_sync(false)).
select
  (select count(*) from items)                                                                  as items,
  (select count(*) from work_items where legacy_source = 'items')                               as work_items_items,
  (select count(*) from proyectos)                                                              as proyectos,
  (select count(*) from projects where legacy_id is not null)                                   as projects,
  (select count(*) from pg_proc where proname in ('f1d_sync', 'f1d_reverse'))                   as f1d_functions_installed,
  (select max(updated_at) from items)                                                           as legacy_items_last_update,
  (select string_agg(tablename || ':' || policyname || ':' || cmd, ', ' order by tablename)
     from pg_policies where schemaname = 'public' and tablename in ('items', 'proyectos', 'hitos', 'comentarios')) as legacy_policies,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'work_items') as realtime_work_items;

-- Cambios pendientes legacy -> pm (solo simulación):
select * from f1d_sync(false);
