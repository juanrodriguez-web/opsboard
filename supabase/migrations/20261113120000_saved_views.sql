-- OpsBoard: saved views for the list view (and later Board / Timeline).
-- A view is only configuration (filters, sorting, grouping, columns) over the same work items; it never stores items.
-- Additive: creates one new table. visibility: private (owner only), team, workspace.
create table if not exists saved_views (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  view_type   text not null default 'list' check (view_type in ('list', 'board', 'timeline')),
  owner_id    uuid references people(id) on delete cascade,
  visibility  text not null default 'private' check (visibility in ('private', 'team', 'workspace')),
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists saved_views_owner_idx on saved_views (owner_id);

drop trigger if exists saved_views_updated_at on saved_views;
create trigger saved_views_updated_at before update on saved_views for each row execute function _set_updated_at();

alter table saved_views enable row level security;
drop policy if exists public_all on saved_views;
create policy public_all on saved_views for all using (true) with check (true);