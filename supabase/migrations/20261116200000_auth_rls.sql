-- OpsBoard: close the database to signed-in team members only (Supabase Auth e-mail link).
-- A signed-in user passes only if their e-mail is in people.email. Everyone else (including the public anon key) gets nothing.
-- DO NOT RUN until: (1) the login is deployed and works with VITE_REQUIRE_AUTH=true, (2) every person who needs access has a row in people
-- with their e-mail, (3) the mail-ingest endpoint is live (the scheduled tasks stop working with the anon key once this runs).
-- Rollback: 20261116200001_auth_rls_rollback.sql (restores the open policies).
create or replace function public.is_opsboard_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.people p
                 where p.email is not null and lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function public.is_opsboard_user() from public;
grant execute on function public.is_opsboard_user() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['activity_events','campanas','checklist_items','comments','f1c_config','f1c_override_field_map',
    'f1c_review_decisions','legacy_localstorage_import','mail_candidates','migration_exceptions','people','plan_accion','projects',
    'saved_views','statuses','work_item_checklists','work_item_relations','work_items'] loop
    execute format('drop policy if exists public_all on public.%I', t);
    execute format('drop policy if exists team_all on public.%I', t);
    execute format('create policy team_all on public.%I for all to authenticated using (public.is_opsboard_user()) with check (public.is_opsboard_user())', t);
  end loop;
  -- frozen legacy tables: read-only, team only
  foreach t in array array['comentarios','hitos','items','proyectos'] loop
    execute format('drop policy if exists legacy_read_only on public.%I', t);
    execute format('drop policy if exists team_read on public.%I', t);
    execute format('create policy team_read on public.%I for select to authenticated using (public.is_opsboard_user())', t);
  end loop;
end $$;
