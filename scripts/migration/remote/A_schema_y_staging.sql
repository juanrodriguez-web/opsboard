-- ===== 20260929120000_pm_core_schema.sql =====
-- ================================================================
-- OpsBoard PM core schema  (F1A)
-- ADDITIVE ONLY: creates new objects, never alters/drops legacy
-- tables (items, proyectos, comentarios, hitos, campanas, plan_accion).
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


-- ===== 20260929120100_pm_reference_data.sql =====
-- OpsBoard PM reference data (F1A): global workflow statuses + people from KNOWN_OWNERS.
-- Idempotent. capacity_h is left NULL on purpose (Workload is a later phase).

insert into statuses (project_id, key, name, category, position)
select null, v.key, v.name, v.category, v.position
from (values
  ('backlog',     'Backlog',     'NOT_STARTED', 10),
  ('planned',     'Planned',     'NOT_STARTED', 20),
  ('in_progress', 'In Progress', 'ACTIVE',      30),
  ('blocked',     'Blocked',     'ACTIVE',      40),
  ('review',      'Review',      'ACTIVE',      50),
  ('done',        'Done',        'DONE',        60),
  ('cancelled',   'Cancelled',   'CANCELLED',   70)
) as v(key, name, category, position)
where not exists (select 1 from statuses s where s.project_id is null and s.key = v.key);

-- Source: KNOWN_OWNERS in src/App.jsx
insert into people (name)
select v.name
from (values ('Juan Rodriguez Peisel'), ('Francisco Toledo'), ('Nacho Cruz'), ('Maria Garcia')) as v(name)
where not exists (select 1 from people p where opsboard_norm(p.name) = opsboard_norm(v.name));


-- ===== 20260929130000_f1c_local_data_staging.sql =====
-- ================================================================
-- OpsBoard F1C — recovery & reconciliation of browser-local data
-- Flow:  capture (file) -> staging (raw, immutable) -> parse -> match
--        -> conflict detection -> reconciliation report -> approval -> apply to `projects`
-- Lifecycle is DERIVED (never a flag flipped on upload):
--   CAPTURED  row exists in legacy_localstorage_import
--   PARSED    raw payload is valid JSON and yielded entries
--   MATCHED   entry resolved to exactly one project/work item
--   REVIEWED  a human decision exists in f1c_review_decisions
--   APPLIED   decision executed (applied_at set)
-- ================================================================

-- Exact replica of parser.js norm(): lower -> NFD -> strip combining marks -> trim.
-- Comment/override keys in localStorage were produced by that function.
create or replace function opsboard_app_norm(t text) returns text
language sql immutable as $$
  select regexp_replace(
           regexp_replace(normalize(lower(coalesce(t, '')), NFD), '[̀-ͯ]', '', 'g'),
           '^\s+|\s+$', '', 'g')
$$;

create or replace function try_jsonb(t text) returns jsonb
language plpgsql immutable as $$ begin return t::jsonb; exception when others then return null; end $$;

-- ── staging ──────────────────────────────────────────────────────
-- One row per (source, localStorage key, content). raw_payload is the exact string found in
-- localStorage and is immutable. source_id identifies a browser-profile+origin installation.
create table if not exists legacy_localstorage_import (
  id                uuid primary key default gen_random_uuid(),
  capture_id        uuid not null,                  -- one per capture run (groups the keys of a run)
  source_id         text not null,
  source_label      text,
  origin            text,                           -- location.origin (localStorage is per origin)
  storage_key       text not null,
  raw_payload       text not null,
  parsed_payload    jsonb,                          -- derived server-side from raw_payload
  payload_hash      text not null,                  -- sha256(raw_payload), derived server-side
  migration_version text not null default 'f1c-1',
  capture_status    text not null default 'CAPTURED' check (capture_status in ('CAPTURED','PARSE_FAILED')),
  captured_at       timestamptz,                    -- client clock; used only to order captures of the SAME source
  imported_at       timestamptz not null default now(),
  unique (source_id, storage_key, payload_hash)
);
create index if not exists legacy_ls_key_idx on legacy_localstorage_import(storage_key);

create or replace function _legacy_ls_before_write() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.raw_payload is distinct from old.raw_payload then
      raise exception 'legacy_localstorage_import.raw_payload is immutable';
    end if;
    return new;
  end if;
  new.payload_hash   := encode(sha256(convert_to(new.raw_payload, 'UTF8')), 'hex');
  new.parsed_payload := try_jsonb(new.raw_payload);
  new.capture_status := case when new.parsed_payload is null then 'PARSE_FAILED' else 'CAPTURED' end;
  return new;
end $$;
drop trigger if exists legacy_ls_before_write on legacy_localstorage_import;
create trigger legacy_ls_before_write before insert or update on legacy_localstorage_import
  for each row execute function _legacy_ls_before_write();

-- ── override field map (obs-proy-overrides field -> projects column) ─────
create table if not exists f1c_override_field_map (
  local_field   text primary key,
  target_column text not null,
  kind          text not null check (kind in ('text','person','date','number','priority','status'))
);
insert into f1c_override_field_map values
  ('descripcion','description','text'), ('propietario','owner_id','person'), ('fechaInicio','start_date','date'),
  ('fechaFin','target_date','date'),    ('prioridad','priority','priority'), ('status','legacy_status','status'),
  ('desarrollo','desarrollo','text'),   ('fase','fase','text'),              ('capex','capex','number'),
  ('nombreEN','name_en','text')
on conflict (local_field) do nothing;

-- Canonical comparable form of a value. Blank -> NULL. Invalid values are kept visibly ('!invalid:...').
create or replace function f1c_canon(kind text, v jsonb) returns text
language plpgsql stable as $$
declare s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  s := btrim(case jsonb_typeof(v) when 'string' then v #>> '{}' else v::text end);
  if s = '' then return null; end if;
  return case kind
    when 'date'   then case when s ~ '^\d{4}-\d{2}-\d{2}$' then s else (s::timestamptz at time zone 'Europe/Madrid')::date::text end
    when 'number' then trim_scale(s::numeric)::text
    when 'person' then opsboard_norm(s)
    else s end;
exception when others then return '!invalid:' || s;
end $$;

-- Current value of an override field in the NEW model / in the LEGACY table (jsonb, comparable via f1c_canon).
create or replace function f1c_current_projects(pid uuid, fld text) returns jsonb
language sql stable as $$
  select case fld
    when 'descripcion' then to_jsonb(p.description)
    when 'propietario' then to_jsonb((select name from people where id = p.owner_id))
    when 'fechaInicio' then to_jsonb(p.start_date)
    when 'fechaFin'    then to_jsonb(p.target_date)
    when 'prioridad'   then to_jsonb(case p.priority when 'urgent' then 'P0' when 'high' then 'P1' when 'medium' then 'P2' when 'low' then 'P3' end)
    when 'status'      then to_jsonb(p.legacy_status)
    when 'desarrollo'  then to_jsonb(p.desarrollo)
    when 'fase'        then to_jsonb(p.fase)
    when 'capex'       then to_jsonb(p.capex)
    when 'nombreEN'    then to_jsonb(p.name_en)
  end from projects p where p.id = pid
$$;
create or replace function f1c_current_legacy(lid text, fld text) returns jsonb
language sql stable as $$
  select case fld
    when 'descripcion' then to_jsonb(l.descripcion)
    when 'propietario' then to_jsonb(l.propietario)
    when 'fechaInicio' then to_jsonb((l.fecha_inicio at time zone 'Europe/Madrid')::date)
    when 'fechaFin'    then to_jsonb((l.fecha_fin at time zone 'Europe/Madrid')::date)
    when 'prioridad'   then to_jsonb(l.prioridad)
    when 'status'      then to_jsonb(l.status)
    when 'desarrollo'  then to_jsonb(l.desarrollo)
    when 'fase'        then to_jsonb(l.fase)
    when 'capex'       then to_jsonb(l.capex)
    when 'nombreEN'    then to_jsonb(l.nombre_en)
  end from proyectos l where l.id = lid
$$;

-- ── parse layer ──────────────────────────────────────────────────
-- State semantics for overrides: only the LATEST capture of each (source, key) counts.
create or replace view v_f1c_latest_import as
select distinct on (source_id, storage_key) *
from legacy_localstorage_import
order by source_id, storage_key, captured_at desc nulls last, imported_at desc;

create or replace view v_f1c_project_override_entries as
select i.id as import_id, i.source_id, i.source_label, i.captured_at,
       k.key as local_key, f.key as local_field, f.value as local_value
from v_f1c_latest_import i
cross join lateral jsonb_each(case when i.storage_key = 'obs-proy-overrides' and jsonb_typeof(i.parsed_payload) = 'object'
                                   then i.parsed_payload else '{}'::jsonb end) k
cross join lateral jsonb_each(case when jsonb_typeof(k.value) = 'object' then k.value else '{}'::jsonb end) f;

-- ── match layer: project keys ────────────────────────────────────
create or replace view v_f1c_project_key_match as
select k.local_key,
       case when ex.n = 1 then 'MATCHED_EXACT' when ex.n > 1 then 'AMBIGUOUS'
            when nm.n = 1 then 'MATCHED_UNIQUE_NORMALIZED' when nm.n > 1 then 'AMBIGUOUS'
            else 'UNMATCHED' end as match_result,
       case when ex.n = 1 then ex.pid when ex.n = 0 and nm.n = 1 then nm.pid end as project_id,
       cand.candidates
from (select distinct local_key from v_f1c_project_override_entries) k
cross join lateral (select count(*) n, (array_agg(id))[1] pid from projects where opsboard_app_norm(name) = k.local_key) ex
cross join lateral (select count(*) n, (array_agg(id))[1] pid from projects where opsboard_norm(name) = opsboard_norm(k.local_key)) nm
cross join lateral (
  select coalesce(jsonb_agg(jsonb_build_object('project_id', c.id, 'name', c.name)), '[]'::jsonb) as candidates
  from (select id, name from projects
         where length(opsboard_norm(k.local_key)) >= 4
           and (opsboard_norm(name) like '%' || opsboard_norm(k.local_key) || '%'
             or opsboard_norm(k.local_key) like '%' || opsboard_norm(name) || '%')
         limit 5) c) cand;

-- ── decisions (human approval) ───────────────────────────────────
create table if not exists f1c_review_decisions (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  field             text not null references f1c_override_field_map(local_field),
  decision          text not null check (decision in ('USE_SOURCE','KEEP_CURRENT','SET_VALUE')),
  source_id         text,
  value             jsonb,
  reviewer          text not null,
  note              text,
  decided_at        timestamptz not null default now(),
  applied_at        timestamptz,
  applied_old_value jsonb,
  applied_new_value jsonb,
  unique (project_id, field),
  check (decision <> 'USE_SOURCE' or source_id is not null),
  check (decision <> 'SET_VALUE' or value is not null)
);

-- ── context config (adjustable, documented as ORIENTATIVE) ───────
-- Dates come from git history, NOT from Vercel deployment logs: a commit time is a lower bound of the
-- real production deploy time. The "modified after window" flag is therefore orientative context only.
create table if not exists f1c_config (key text primary key, value text not null, note text);
insert into f1c_config (key, value, note) values
  ('legacy_editor_window_end', '2026-06-18T10:54:09+02:00',
   'ORIENTATIVE: git author time of commit 78a5c32 (ModalProyecto replaced by ProjectDetailView). Not the production deploy time.'),
  ('db_project_edit_paths_from', '2026-06-19T08:11:21+02:00',
   'ORIENTATIVE: git commit 39e87b4 introduced guardarProyecto and the Backlog button (Activar: commit 143ce2a, 2026-06-18T11:19:54+02:00). Not deploy times.')
on conflict (key) do nothing;
create or replace function f1c_cutoff() returns timestamptz language sql stable as
  $$ select value::timestamptz from f1c_config where key = 'legacy_editor_window_end' $$;

-- ── reconciliation: one row per (project, field, source) ─────────
-- Classification is DATA-DRIVEN. recommended_action / review_risk are hints for the reviewer;
-- they never create a decision (decisions only exist in f1c_review_decisions).
create or replace view v_f1c_project_reconciliation as
with e as (
  select en.*, m.match_result, m.project_id, m.candidates, fm.kind, fm.target_column,
         f1c_canon(fm.kind, en.local_value) as local_canon
  from v_f1c_project_override_entries en
  join v_f1c_project_key_match m on m.local_key = en.local_key
  left join f1c_override_field_map fm on fm.local_field = en.local_field),
c as (
  select e.*, p.legacy_id as project_legacy_id, p.name as project_name,
         l.created_at as project_created_at, l.updated_at as project_updated_at,   -- legacy `proyectos` (active source)
         coalesce(l.updated_at > l.created_at and l.updated_at > f1c_cutoff(), false) as modified_after,
         f1c_canon(e.kind, f1c_current_legacy(p.legacy_id, e.local_field))   as current_legacy_canon,
         f1c_canon(e.kind, f1c_current_projects(e.project_id, e.local_field)) as current_projects_canon
  from e left join projects p on p.id = e.project_id
         left join proyectos l on l.id = p.legacy_id),
agg as (
  select coalesce(project_id::text, local_key) as pk, local_field,
         count(distinct source_id) as n_sources,
         count(distinct coalesce(local_canon, '<blank>')) as n_distinct_local,
         jsonb_agg(jsonb_build_object('source_id', source_id, 'label', source_label, 'value', local_canon) order by source_id) as by_source
  from c group by 1, 2)
, r as (
select c.local_key, c.project_legacy_id, c.project_id, c.project_name, c.local_field as field,
       c.project_created_at, c.project_updated_at, c.modified_after,
       (c.current_legacy_canon is not null) as db_value_present,
       (c.local_canon is not null)          as local_value_present,
       (a.n_distinct_local > 1)             as multiple_local_values,
       (c.local_field in ('status','fechaInicio','fechaFin','descripcion')) as sensitive_field,  -- later writable via Supabase paths
       c.current_legacy_canon   as supabase_legacy_value,
       c.current_projects_canon as projects_value,
       coalesce(c.local_value #>> '{}', '') as local_value,       -- as typed in the browser
       c.local_canon            as local_value_canon,              -- comparable form (blank => NULL)
       c.local_value            as local_value_raw,
       c.source_id, c.source_label, c.match_result, c.candidates,
       a.n_sources, a.n_distinct_local, a.by_source,
       case
         when d.applied_at is not null then 'APPLIED'
         when c.match_result not in ('MATCHED_EXACT','MATCHED_UNIQUE_NORMALIZED') then 'NOT_MATCHED'
         when c.kind is null then 'UNKNOWN_FIELD'
         when a.n_distinct_local > 1 then 'SOURCE_CONFLICT'
         when c.current_legacy_canon is distinct from c.current_projects_canon then 'DB_DRIFT'
         when c.local_canon is not distinct from c.current_projects_canon then 'NOOP'
         when c.current_projects_canon is null then 'LOCAL_ONLY_ADDITION'
         else 'DB_DIFFERS' end as conflict_type,
       d.decision, d.applied_at
from c
join agg a on a.pk = coalesce(c.project_id::text, c.local_key) and a.local_field = c.local_field
left join f1c_review_decisions d on d.project_id = c.project_id and d.field = c.local_field)
select r.*,
       -- risks are facts about the data; several may apply (';'-joined). NULL = nothing to flag.
       nullif(array_to_string(array_remove(array[
         case when r.conflict_type = 'DB_DIFFERS' and r.modified_after then 'DB_MODIFIED_AFTER_OVERRIDE_WINDOW' end,
         case when r.conflict_type = 'DB_DIFFERS' and not r.local_value_present then 'LOCAL_BLANK_WOULD_CLEAR_DB' end,
         case when r.conflict_type = 'LOCAL_ONLY_ADDITION' and r.sensitive_field and r.modified_after then 'SENSITIVE_FIELD_DB_MAY_HAVE_BEEN_CLEARED' end
       ]::text[], null), ';'), '') as review_risk,
       case r.conflict_type
         when 'NOOP' then 'NO_ACTION' when 'APPLIED' then 'NO_ACTION'
         when 'LOCAL_ONLY_ADDITION' then 'SAFE_LOCAL_ADDITION'
         when 'DB_DIFFERS' then 'REVIEW_DB_VS_LOCAL' when 'DB_DRIFT' then 'REVIEW_DB_VS_LOCAL'
         when 'SOURCE_CONFLICT' then 'REVIEW_SOURCE_CONFLICT'
         else 'REVIEW_MATCH' end as recommended_action
from r;

-- Human-facing report: yes/no conflict flag, DB context, derived lifecycle stage.
create or replace view v_f1c_project_reconciliation_report as
select project_legacy_id, project_name, project_id, field,
       project_created_at, project_updated_at,
       modified_after as db_modified_after_legacy_editor_window,
       modified_after as project_modified_after_cutoff,
       supabase_legacy_value as db_current_value,               -- legacy `proyectos` = active source
       projects_value,                                           -- migrated copy in `projects`
       local_value as local_override_value,                      -- as typed in the browser
       source_id, source_label,
       match_result as match_status, conflict_type,
       (conflict_type in ('SOURCE_CONFLICT','DB_DIFFERS','DB_DRIFT')) as conflict,
       review_risk, recommended_action,
       db_value_present, local_value_present, multiple_local_values, sensitive_field,
       n_sources, n_distinct_local, local_key,
       (select 'window end ' || value || ' — ' || note from f1c_config where key = 'legacy_editor_window_end') as window_end_basis,
       case when applied_at is not null then 'APPLIED'
            when decision is not null then 'REVIEWED'
            when match_result in ('MATCHED_EXACT','MATCHED_UNIQUE_NORMALIZED') then 'MATCHED'
            else 'PARSED' end as lifecycle,
       decision
from v_f1c_project_reconciliation
order by project_name nulls last, field, source_id;

-- ── comments: staged + classified, NEVER applied in this phase ───
create or replace view v_f1c_comment_entries as
select i.id as import_id, i.source_id, i.source_label, i.captured_at,
       case i.storage_key when 'obs-comments' then 'item' else 'project' end as scope,
       c.value ->> 'k' as k, c.value ->> 'id' as local_id, c.value ->> 'iso' as iso, c.value ->> 'ts' as ts,
       c.value ->> 'text' as body
from legacy_localstorage_import i
cross join lateral jsonb_array_elements(
  case when i.storage_key in ('obs-comments','obs-proj-comments') and jsonb_typeof(i.parsed_payload) = 'array'
       then i.parsed_payload else '[]'::jsonb end) c(value);
-- (comments use ALL captures, not only the latest: the app caps the list at 300 so older captures may hold more)

create or replace view v_f1c_comment_classification as
with d as (
  select scope, k, iso, body, md5(scope || '|' || coalesce(k, '') || '|' || coalesce(iso, '') || '|' || coalesce(body, '')) as content_key,
         array_agg(distinct source_id order by source_id) as sources, min(ts) as ts
  from v_f1c_comment_entries group by scope, k, iso, body)
select d.content_key, d.scope, d.k as local_key, d.iso, d.ts, d.body, d.sources, cardinality(d.sources) as n_sources,
       m.match_result, m.target_id, m.note, m.candidates,
       case when m.match_result in ('MATCHED_EXACT','MATCHED_UNIQUE_NORMALIZED') then 'MATCHED' else 'PARSED' end as lifecycle
from d
cross join lateral (
  select case when x.n_exact = 1 then 'MATCHED_EXACT' when x.n_exact > 1 then 'AMBIGUOUS'
              when x.n_norm = 1 then 'MATCHED_UNIQUE_NORMALIZED' when x.n_norm > 1 then 'AMBIGUOUS' else 'UNMATCHED' end as match_result,
         case when x.n_exact = 1 then x.exact_id when x.n_exact = 0 and x.n_norm = 1 then x.norm_id end as target_id,
         case when x.n_exact = 0 and x.n_norm = 0 and x.legacy_present > 0 then 'TARGET_NOT_MIGRATED (held by a BLOCKING exception)' end as note,
         x.candidates
  from (
    select
      case when d.scope = 'item' then (select count(*) from work_items w where w.legacy_source = 'items' and opsboard_app_norm(w.title) = d.k)
           else (select count(*) from projects p where opsboard_app_norm(p.name) = d.k) end as n_exact,
      case when d.scope = 'item' then (select count(*) from work_items w where w.legacy_source = 'items' and opsboard_norm(w.title) = opsboard_norm(d.k))
           else (select count(*) from projects p where opsboard_norm(p.name) = opsboard_norm(d.k)) end as n_norm,
      case when d.scope = 'item' then (select (array_agg(w.id))[1] from work_items w where w.legacy_source = 'items' and opsboard_app_norm(w.title) = d.k)
           else (select (array_agg(p.id))[1] from projects p where opsboard_app_norm(p.name) = d.k) end as exact_id,
      case when d.scope = 'item' then (select (array_agg(w.id))[1] from work_items w where w.legacy_source = 'items' and opsboard_norm(w.title) = opsboard_norm(d.k))
           else (select (array_agg(p.id))[1] from projects p where opsboard_norm(p.name) = opsboard_norm(d.k)) end as norm_id,
      case when d.scope = 'item' then (select count(*) from items i where opsboard_app_norm(i.tema) = d.k)
           else (select count(*) from proyectos i where opsboard_app_norm(i.nombre) = d.k) end as legacy_present,
      case when d.scope = 'item' then
             (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title)), '[]'::jsonb)
                from (select id, title from work_items w
                       where w.legacy_source = 'items' and length(opsboard_norm(d.k)) >= 4
                         and (opsboard_norm(w.title) = opsboard_norm(d.k)
                           or opsboard_norm(w.title) like '%' || opsboard_norm(d.k) || '%'
                           or opsboard_norm(d.k) like '%' || opsboard_norm(w.title) || '%') limit 5) c)
           else
             (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.name)), '[]'::jsonb)
                from (select id, name from projects p
                       where length(opsboard_norm(d.k)) >= 4
                         and (opsboard_norm(p.name) like '%' || opsboard_norm(d.k) || '%'
                           or opsboard_norm(d.k) like '%' || opsboard_norm(p.name) || '%') limit 5) c) end as candidates
  ) x) m;

-- ── done_ts: evidence only. NEVER used to fill completed_at ─────
create or replace view v_f1c_done_ts as
select s.source_id, s.item_legacy_id, s.ts_ms, to_timestamp(s.ts_ms / 1000.0) as ts,
       count(*) over (partition by s.source_id, s.ts_ms) as same_ts_in_source,
       case when count(*) over (partition by s.source_id, s.ts_ms) > 1 then 'LIKELY_FABRICATED (same ms for several items)'
            else 'UNKNOWN' end as evidence,
       w.id as work_item_id, w.completed_at
from (select i.source_id, substr(i.storage_key, 13) as item_legacy_id,
             case when (i.parsed_payload #>> '{}') ~ '^\d+$' then (i.parsed_payload #>> '{}')::bigint end as ts_ms
        from v_f1c_latest_import i where i.storage_key like 'obs-done-ts-%') s
left join work_items w on w.legacy_source = 'items' and w.legacy_id = s.item_legacy_id;

-- ── approval / apply ─────────────────────────────────────────────
create or replace function f1c_approve(p_project_legacy_id text, p_field text, p_decision text,
                                       p_source_id text, p_value jsonb, p_reviewer text, p_note text default null)
returns void language plpgsql as $$
declare pid uuid;
begin
  select id into pid from projects where legacy_id = p_project_legacy_id;
  if pid is null then raise exception 'unknown project %', p_project_legacy_id; end if;
  if exists (select 1 from f1c_review_decisions where project_id = pid and field = p_field and applied_at is not null) then
    raise exception 'decision for % / % already applied', p_project_legacy_id, p_field;
  end if;
  insert into f1c_review_decisions (project_id, field, decision, source_id, value, reviewer, note)
  values (pid, p_field, p_decision, p_source_id, p_value, p_reviewer, p_note)
  on conflict (project_id, field) do update
    set decision = excluded.decision, source_id = excluded.source_id, value = excluded.value,
        reviewer = excluded.reviewer, note = excluded.note, decided_at = now();
end $$;

-- Convenience (explicit call by a human): approve conflict-free additions = local value where the DB is blank
-- and all sources agree (recommended_action SAFE_LOCAL_ADDITION). Rows carrying a review_risk (e.g. a sensitive
-- field whose DB value may have been cleared on purpose) are skipped unless p_include_flagged is true.
create or replace function f1c_approve_clean(p_reviewer text, p_include_flagged boolean default false) returns integer
language plpgsql as $$
declare n integer;
begin
  with ins as (
    insert into f1c_review_decisions (project_id, field, decision, source_id, reviewer, note)
    select distinct on (project_id, field) project_id, field, 'USE_SOURCE', source_id, p_reviewer, 'approve_clean'
    from v_f1c_project_reconciliation
    where recommended_action = 'SAFE_LOCAL_ADDITION' and decision is null
      and (p_include_flagged or review_risk is null)
    order by project_id, field, source_id
    on conflict (project_id, field) do nothing
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;

-- Applies REVIEWED decisions to `projects` (never to legacy tables). Idempotent: applied rows are skipped.
create or replace function f1c_apply_project_overrides()
returns table (project_id uuid, field text, old_value jsonb, new_value jsonb)
language plpgsql as $$
#variable_conflict use_column
declare d f1c_review_decisions; fm f1c_override_field_map; val jsonb; c text; oldv jsonb; owner_uuid uuid; prio text;
begin
  for d in select * from f1c_review_decisions where applied_at is null order by decided_at loop
    select * into fm from f1c_override_field_map where local_field = d.field;
    oldv := f1c_current_projects(d.project_id, d.field);
    if d.decision = 'KEEP_CURRENT' then
      update f1c_review_decisions set applied_at = now(), applied_old_value = oldv, applied_new_value = oldv where id = d.id;
      project_id := d.project_id; field := d.field; old_value := oldv; new_value := oldv; return next; continue;
    end if;
    if d.decision = 'USE_SOURCE' then
      select e.local_value into val
      from v_f1c_project_override_entries e join v_f1c_project_key_match m on m.local_key = e.local_key
      where m.project_id = d.project_id and e.local_field = d.field and e.source_id = d.source_id;
      if not found then raise exception 'no staged value for project %, field %, source %', d.project_id, d.field, d.source_id; end if;
    else val := d.value; end if;
    c := f1c_canon(fm.kind, val);
    if c like '!invalid:%' then raise exception 'invalid value for %: %', d.field, c; end if;

    case d.field
      when 'descripcion' then update projects set description = coalesce(c, '') where id = d.project_id;
      when 'desarrollo'  then update projects set desarrollo  = coalesce(c, '') where id = d.project_id;
      when 'fase'        then update projects set fase        = coalesce(c, '') where id = d.project_id;
      when 'nombreEN'    then update projects set name_en     = c where id = d.project_id;
      when 'capex'       then update projects set capex       = c::numeric where id = d.project_id;
      when 'fechaInicio' then update projects set start_date  = c::date where id = d.project_id;
      when 'fechaFin'    then update projects set target_date = c::date where id = d.project_id;
      when 'propietario' then
        if c is null then owner_uuid := null;
        else select id into owner_uuid from people where opsboard_norm(name) = c;
             if owner_uuid is null then raise exception 'unknown owner %', val; end if; end if;
        update projects set owner_id = owner_uuid where id = d.project_id;
      when 'prioridad' then
        prio := case c when 'P0' then 'urgent' when 'P1' then 'high' when 'P2' then 'medium' when 'P3' then 'low' end;
        if c is not null and prio is null then raise exception 'invalid priority %', c; end if;
        update projects set priority = prio where id = d.project_id;
      when 'status' then
        if c is null or c not in ('pending','inprogress','blocked','done','backlog') then raise exception 'invalid status %', c; end if;
        update projects set legacy_status = c,
               status = case c when 'pending' then 'planning' when 'backlog' then 'planning' when 'inprogress' then 'active'
                               when 'blocked' then 'active' when 'done' then 'completed' end,
               health = case c when 'blocked' then 'at_risk' else health end
         where id = d.project_id;
    end case;

    insert into activity_events (entity_type, entity_id, action, old_value, new_value)
    values ('project', d.project_id, 'f1c_apply:' || d.field, oldv, f1c_current_projects(d.project_id, d.field));
    update f1c_review_decisions set applied_at = now(), applied_old_value = oldv,
           applied_new_value = f1c_current_projects(d.project_id, d.field) where id = d.id;
    project_id := d.project_id; field := d.field; old_value := oldv; new_value := f1c_current_projects(d.project_id, d.field);
    return next;
  end loop;
end $$;

-- ── stage counters ───────────────────────────────────────────────
create or replace view v_f1c_status as
select 1 as ord, 'CAPTURED' as stage, 'staging rows' as metric, count(*)::int as n from legacy_localstorage_import
union all select 2, 'CAPTURED', 'sources', count(distinct source_id)::int from legacy_localstorage_import
union all select 3, 'CAPTURED', 'captures', count(distinct capture_id)::int from legacy_localstorage_import
union all select 4, 'PARSED', 'rows with invalid JSON (PARSE_FAILED)', count(*)::int from legacy_localstorage_import where capture_status = 'PARSE_FAILED'
union all select 5, 'PARSED', 'override field entries (latest per source)', count(*)::int from v_f1c_project_override_entries
union all select 6, 'PARSED', 'unique comments (item+project)', count(*)::int from v_f1c_comment_classification
union all select 7, 'MATCHED', 'override keys ' || match_result, count(*)::int from v_f1c_project_key_match group by match_result
union all select 8, 'MATCHED', 'comments ' || scope || ' ' || match_result, count(*)::int from v_f1c_comment_classification group by scope, match_result
union all select 9, 'REVIEW', 'override fields in conflict (unresolved)', count(distinct (project_id, field))::int
  from v_f1c_project_reconciliation_report where conflict and decision is null
union all select 10, 'REVIEW', 'override fields needing review: not matched (keys)', count(distinct local_key)::int
  from v_f1c_project_reconciliation_report where conflict_type = 'NOT_MATCHED'
union all select 11, 'REVIEWED', 'decisions', count(*)::int from f1c_review_decisions
union all select 12, 'APPLIED', 'decisions applied to projects', count(*)::int from f1c_review_decisions where applied_at is not null
union all select 13, 'APPLIED', 'comments applied (not implemented in this phase)', 0
union all select 14, 'EVIDENCE', 'done_ts entries (never applied)', count(*)::int from v_f1c_done_ts;

-- ── RLS (same open policy as the rest) ───────────────────────────
do $$ declare t text; begin
  foreach t in array array['legacy_localstorage_import','f1c_override_field_map','f1c_review_decisions','f1c_config'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists public_all on %I', t);
    execute format('create policy public_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;
