-- Rollback of 20261116200000_auth_rls.sql: back to the open policies (anyone with the public key can read and write).
-- Run it in the Supabase SQL Editor if the team is locked out. Keep Vercel VITE_REQUIRE_AUTH off (or unset) afterwards.
do $$
declare t text;
begin
  foreach t in array array['activity_events','campanas','checklist_items','comments','f1c_config','f1c_override_field_map',
    'f1c_review_decisions','legacy_localstorage_import','mail_candidates','migration_exceptions','people','plan_accion','projects',
    'saved_views','statuses','work_item_checklists','work_item_relations','work_items'] loop
    execute format('drop policy if exists team_all on public.%I', t);
    execute format('drop policy if exists public_all on public.%I', t);
    execute format('create policy public_all on public.%I for all using (true) with check (true)', t);
  end loop;
  foreach t in array array['comentarios','hitos','items','proyectos'] loop
    execute format('drop policy if exists team_read on public.%I', t);
    execute format('drop policy if exists legacy_read_only on public.%I', t);
    execute format('create policy legacy_read_only on public.%I for select using (true)', t);
  end loop;
end $$;
