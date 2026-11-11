-- ================================================================
-- OpsBoard PM core schema  (F1A)
-- ADDITIVE ONLY: creates new objects, never alters/drops legacy
-- tables (items, proyectos, comentarios, hitos, campanas, plan_accion).
-- NOT applied to remote. Apply only to local/dev until F1 is authorized.
-- ================================================================

-- ── Helpers ──────────────────────────────────────────────────────
-- Accent/case/whitespace-insensitive comparison key (mirrors parser.js norm(),
-- plus whitespace collapsing).
create or replace function opsboard_norm(t text) returns text
language sql immutable as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(t, '')),
              'áàäâãéèëêíìïîóòöôõúùüûñç',
              'aaaaaeeeeiiiiooooouuuunc'),
    '\s+', ' ', 'g'))
$$;

create or replace function _set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ── people ───────────────────────────────────────────────────────
-- auth_user_id is intentionally a plain nullable uuid (no FK to auth.users yet):
-- Auth is out of scope; the FK can be added when Supabase Auth is introduced.
create table if not exists people (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text,
  role          text,
  capacity_h    numeric check (capacity_h is null or capacity_h >= 0),  -- nullable: Workload is a later phase
  auth_user_id  uuid unique,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists people_name_norm_uq on people (opsboard_norm(name));
create unique index if not exists people_email_uq on people (lower(email)) where email is not null;

-- ── projects (evolution of legacy `proyectos`; legacy fields preserved) ──
create table if not exists projects (
  id              uuid primary key default gen_random_uuid(),
  legacy_id       text unique,                      -- proyectos.id
  name            text not null,
  name_en         text,
  description     text not null default '',
  owner_id        uuid references people(id),
  status          text not null default 'planning'
                  check (status in ('planning','active','on_hold','completed','cancelled')),
  health          text not null default 'not_set'
                  check (health in ('on_track','at_risk','off_track','not_set')),
  priority        text check (priority in ('urgent','high','medium','low')),
  start_date      date,
  target_date     date,
  progress_mode   text not null default 'calculated' check (progress_mode in ('calculated','manual')),
  progress_manual numeric check (progress_manual is null or (progress_manual >= 0 and progress_manual <= 100)),
  -- legacy fields kept as-is (nothing dropped)
  fase            text not null default '',
  capex           numeric,
  desarrollo      text not null default '',
  notes           text not null default '',
  legacy_status   text,                             -- proyectos.status  (pending|inprogress|blocked|done|backlog)
  legacy_estado   text,                             -- proyectos.estado  (free text)
  created_by      uuid references people(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists projects_owner_idx on projects(owner_id);
create unique index if not exists projects_name_norm_uq on projects (opsboard_norm(name));

-- ── statuses ─────────────────────────────────────────────────────
-- project_id NULL = global workflow. A "blocked" state is inferred from key = 'blocked'.
create table if not exists statuses (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects(id) on delete cascade,
  key         text not null,
  name        text not null,
  category    text not null check (category in ('NOT_STARTED','ACTIVE','DONE','CANCELLED')),
  position    integer not null default 0,
  active      boolean not null default true
);
create unique index if not exists statuses_scope_key_uq
  on statuses (coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

-- ── work_items (single source of truth per item) ─────────────────
create table if not exists work_items (
  id              uuid primary key default gen_random_uuid(),
  number          bigint generated always as identity unique,   -- human key: TYPE-<number>
  legacy_source   text check (legacy_source in ('items','hitos')),
  legacy_id       text,
  type            text not null default 'task'
                  check (type in ('task','topic','milestone','issue','risk','decision')),
  project_id      uuid references projects(id) on delete restrict,   -- nullable: 34/48 legacy items have no project
  parent_id       uuid references work_items(id) on delete cascade,
  title           text not null check (btrim(title) <> ''),
  description     text not null default '',
  notes           text not null default '',
  status_id       uuid not null references statuses(id),
  priority        text check (priority in ('urgent','high','medium','low')),
  assignee_id     uuid references people(id),
  start_date      date,
  due_date        date,
  estimate_h      numeric check (estimate_h is null or estimate_h >= 0),
  tags            text[] not null default '{}',
  risk            text check (risk in ('green','yellow','red')),
  created_by      uuid references people(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz,
  legacy_subtareas jsonb not null default '[]'::jsonb,   -- items.subtareas verbatim; exploded into child rows in F2
  legacy          jsonb not null default '{}'::jsonb,    -- estado_sheet, archivos, category, proyecto (original text)
  check (parent_id is null or parent_id <> id)
);
create unique index if not exists work_items_legacy_uq on work_items (legacy_source, legacy_id);
create index if not exists work_items_project_idx  on work_items(project_id);
create index if not exists work_items_assignee_idx on work_items(assignee_id);
create index if not exists work_items_status_idx   on work_items(status_id);
create index if not exists work_items_due_idx      on work_items(due_date);
create index if not exists work_items_parent_idx   on work_items(parent_id);
create index if not exists work_items_tags_idx     on work_items using gin (tags);

-- completed_at is maintained only on status *changes* (UPDATE). Inserts keep whatever
-- is given, so the data migration never fabricates completion dates.
create or replace function _work_items_completion() returns trigger
language plpgsql as $$
declare cat text;
begin
  if new.status_id is distinct from old.status_id then
    select category into cat from statuses where id = new.status_id;
    if cat = 'DONE' then
      new.completed_at := coalesce(new.completed_at, now());
    else
      new.completed_at := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists work_items_completion on work_items;
create trigger work_items_completion before update on work_items
  for each row execute function _work_items_completion();

-- ── relations ────────────────────────────────────────────────────
-- ONE row per relation.  (A, B, 'blocks')  =  A blocks B  ==  B is blocked by A.
-- 'related' is symmetric, stored once with from_id < to_id.
create table if not exists work_item_relations (
  id          uuid primary key default gen_random_uuid(),
  from_id     uuid not null references work_items(id) on delete cascade,
  to_id       uuid not null references work_items(id) on delete cascade,
  kind        text not null check (kind in ('blocks','related')),
  created_by  uuid references people(id),
  created_at  timestamptz not null default now(),
  check (from_id <> to_id),
  check (kind <> 'related' or from_id < to_id),
  unique (from_id, to_id, kind)
);
create index if not exists work_item_relations_to_idx on work_item_relations(to_id);

-- ── comments / activity / checklists (schema only; no UI yet) ────
create table if not exists comments (
  id            uuid primary key default gen_random_uuid(),
  work_item_id  uuid references work_items(id) on delete cascade,
  project_id    uuid references projects(id) on delete cascade,
  parent_id     uuid references comments(id) on delete cascade,
  author_id     uuid references people(id),
  body          text not null,
  legacy_ref    text unique,                      -- idempotency key for imported comments
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((work_item_id is not null)::int + (project_id is not null)::int = 1)
);
create index if not exists comments_item_idx on comments(work_item_id);
create index if not exists comments_project_idx on comments(project_id);

create table if not exists activity_events (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null,
  entity_id    uuid not null,
  actor_id     uuid references people(id),
  action       text not null,
  old_value    jsonb,
  new_value    jsonb,
  ts           timestamptz not null default now()
);
create index if not exists activity_entity_idx on activity_events(entity_type, entity_id, ts desc);

create table if not exists work_item_checklists (
  id            uuid primary key default gen_random_uuid(),
  work_item_id  uuid not null references work_items(id) on delete cascade,
  title         text not null default 'Checklist',
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);
create table if not exists checklist_items (
  id            uuid primary key default gen_random_uuid(),
  checklist_id  uuid not null references work_item_checklists(id) on delete cascade,
  text          text not null,
  done          boolean not null default false,
  position      integer not null default 0,
  done_at       timestamptz
);

-- ── migration support ────────────────────────────────────────────
-- Report of data-migration exceptions (rebuilt on every run of the F1B script).
create table if not exists migration_exceptions (
  id          bigint generated always as identity primary key,
  severity    text not null check (severity in ('BLOCKING','WARN','INFO')),
  code        text not null,
  entity      text not null,
  legacy_id   text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ── triggers ─────────────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['people','projects','work_items','comments'] loop
    execute format('drop trigger if exists %I_updated_at on %I', t, t);
    execute format('create trigger %I_updated_at before update on %I for each row execute function _set_updated_at()', t, t);
  end loop;
end $$;

-- ── RLS: same open policy as the legacy tables (no per-user RLS in this phase) ──
do $$ declare t text; begin
  foreach t in array array['people','projects','statuses','work_items','work_item_relations','comments',
                           'activity_events','work_item_checklists','checklist_items',
                           'migration_exceptions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists public_all on %I', t);
    execute format('create policy public_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- Visible key is presented as OB-<number> (entity-agnostic prefix; the UI must not assume TASK-).
comment on column work_items.number is 'Human-readable sequence. Display as OB-<number>.';
