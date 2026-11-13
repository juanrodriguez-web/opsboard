-- C4 · 30 TIEMPO REAL (D5). Añade work_items a la publicación para que la app reciba cambios en vivo.
-- Solo si no estaba ya. No afecta a los datos.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'La publicación supabase_realtime no existe: activa Realtime en el panel de Supabase';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_items') then
    alter publication supabase_realtime add table public.work_items;
  end if;
end $$;
select pubname, tablename from pg_publication_tables where pubname = 'supabase_realtime';
