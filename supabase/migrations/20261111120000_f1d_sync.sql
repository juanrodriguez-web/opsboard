-- ================================================================
-- OpsBoard F1D — legacy <-> pm synchronisation (cutover tooling)
--   f1d_sync(apply)     legacy -> pm   used BEFORE the cutover (legacy is the source of truth)
--   f1d_reverse(apply)  pm -> legacy   used only for a ROLLBACK (pm is the source of truth)
-- Both are DRY-RUN by default (apply = false): they only return the list of pending changes.
-- Only one direction is ever meaningful at a time; there is no continuous sync.
-- Additive: creates functions only; no table or data is changed by this migration.
-- ================================================================

-- ── completed_at: never fabricated while syncing ─────────────────
create or replace function _work_items_completion() returns trigger
language plpgsql as $$
declare cat text;
begin
  if current_setting('opsboard.sync', true) = 'on' then return new; end if;   -- sync keeps completed_at untouched
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

-- ── value mappings (single definition, used by both directions) ──
create or replace function f1d_status_key(l text) returns text language sql immutable as $$
  select case l when 'pending' then 'planned' when 'inprogress' then 'in_progress' when 'blocked' then 'blocked'
                when 'done' then 'done' when 'backlog' then 'backlog' end $$;
create or replace function f1d_status_legacy(k text) returns text language sql immutable as $$
  select case k when 'planned' then 'pending' when 'in_progress' then 'inprogress' when 'review' then 'inprogress'
                when 'blocked' then 'blocked' when 'done' then 'done' when 'cancelled' then 'done' when 'backlog' then 'backlog' end $$;
create or replace function f1d_estado_sheet(legacy_status text) returns text language sql immutable as $$
  select case legacy_status when 'pending' then 'No iniciado' when 'inprogress' then 'Según lo planificado'
                when 'blocked' then 'En peligro' when 'done' then 'Hecho' when 'backlog' then 'No iniciado' end $$;
create or replace function f1d_prio_pm(l text) returns text language sql immutable as $$
  select case l when 'P0' then 'urgent' when 'P1' then 'high' when 'P2' then 'medium' when 'P3' then 'low' end $$;
create or replace function f1d_prio_legacy(p text) returns text language sql immutable as $$
  select case p when 'urgent' then 'P0' when 'high' then 'P1' when 'medium' then 'P2' when 'low' then 'P3' else '' end $$;
create or replace function f1d_date(ts timestamptz) returns date language sql immutable as $$
  select (ts at time zone 'Europe/Madrid')::date $$;
create or replace function f1d_ts(d date) returns timestamptz language sql immutable as $$
  select (d::timestamp at time zone 'Europe/Madrid') $$;
create or replace function f1d_pstatus(l text) returns text language sql immutable as $$
  select case l when 'pending' then 'planning' when 'backlog' then 'planning' when 'inprogress' then 'active'
                when 'blocked' then 'active' when 'done' then 'completed' end $$;
create or replace function f1d_pstatus_legacy(s text) returns text language sql immutable as $$
  select case s when 'planning' then 'pending' when 'active' then 'inprogress' when 'on_hold' then 'blocked'
                when 'completed' then 'done' when 'cancelled' then 'done' end $$;
create or replace function f1d_newid() returns text language sql volatile as $$
  select substr(md5(gen_random_uuid()::text), 1, 7) $$;

-- ================================================================
-- legacy -> pm
-- ================================================================
create or replace function f1d_sync(p_apply boolean default false)
returns table (entity text, action text, legacy_id text, detail jsonb)
language plpgsql as $$
#variable_conflict use_column
begin
  perform set_config('opsboard.sync', 'on', true);
  drop table if exists _plan, _ppl, _mp, _mi, _mh, _mc;
  create temp table _plan (ord int, entity text, action text, legacy_id text, detail jsonb) on commit drop;

  -- ── people: owner names used in legacy but unknown to `people` (decision D1: create) ──
  create temp table _ppl on commit drop as
  select distinct on (opsboard_norm(n)) btrim(n) as name
  from (select propietario n from proyectos union all select propietario from items) s
  where nullif(btrim(n), '') is not null
    and not exists (select 1 from people p where opsboard_norm(p.name) = opsboard_norm(s.n))
  order by opsboard_norm(n), n;
  insert into _plan select 10, 'people', 'create', null, jsonb_build_object('name', name) from _ppl;
  if p_apply then insert into people (name) select name from _ppl; end if;

  -- ── projects (mapped) ──
  create temp table _mp on commit drop as
  select p.id as legacy_id, p.nombre as name, nullif(p.nombre_en, '') as name_en, coalesce(p.descripcion, '') as description,
         (select id from people x where opsboard_norm(x.name) = opsboard_norm(p.propietario) limit 1) as owner_id,
         f1d_pstatus(p.status) as status,
         case p.status when 'blocked' then 'at_risk' else 'not_set' end as health,
         f1d_prio_pm(nullif(btrim(p.prioridad), '')) as priority,
         f1d_date(p.fecha_inicio) as start_date, f1d_date(p.fecha_fin) as target_date,
         coalesce(p.fase, '') as fase, p.capex, coalesce(p.desarrollo, '') as desarrollo, coalesce(p.notas, '') as notes,
         p.status as legacy_status, p.estado as legacy_estado,
         case when nullif(btrim(p.nombre), '') is null then 'name_empty'
              when p.status is null or p.status not in ('pending','inprogress','blocked','done','backlog') then 'status_unexpected'
              when nullif(btrim(p.prioridad), '') is not null and p.prioridad not in ('P0','P1','P2','P3') then 'priority_unexpected'
              when count(*) over (partition by opsboard_norm(p.nombre)) > 1 then 'name_duplicate'
              when exists (select 1 from projects x where opsboard_norm(x.name) = opsboard_norm(p.nombre) and x.legacy_id is distinct from p.id) then 'name_clash'
         end as problem
  from proyectos p;
  insert into _plan select 20, 'projects', 'skip_invalid', legacy_id, jsonb_build_object('problem', problem) from _mp where problem is not null;

  insert into _plan select 21, 'projects', 'insert', m.legacy_id, jsonb_build_object('name', m.name)
    from _mp m where m.problem is null and not exists (select 1 from projects p where p.legacy_id = m.legacy_id);
  insert into _plan select 22, 'projects', 'update', m.legacy_id,
         (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(m) - 'legacy_id' - 'problem') e where to_jsonb(p) -> e.key is distinct from e.value)
    from _mp m join projects p on p.legacy_id = m.legacy_id
    where m.problem is null
      and (select count(*) from jsonb_each(to_jsonb(m) - 'legacy_id' - 'problem') e where to_jsonb(p) -> e.key is distinct from e.value) > 0;

  if p_apply then
    insert into projects (legacy_id, name, name_en, description, owner_id, status, health, priority, start_date, target_date, fase, capex, desarrollo, notes, legacy_status, legacy_estado)
      select m.legacy_id, m.name, m.name_en, m.description, m.owner_id, m.status, m.health, m.priority, m.start_date, m.target_date, m.fase, m.capex, m.desarrollo, m.notes, m.legacy_status, m.legacy_estado
      from _mp m where m.problem is null and not exists (select 1 from projects p where p.legacy_id = m.legacy_id);
    update projects p set name = m.name, name_en = m.name_en, description = m.description, owner_id = m.owner_id, status = m.status, health = m.health,
           priority = m.priority, start_date = m.start_date, target_date = m.target_date, fase = m.fase, capex = m.capex, desarrollo = m.desarrollo,
           notes = m.notes, legacy_status = m.legacy_status, legacy_estado = m.legacy_estado
      from _mp m where m.legacy_id = p.legacy_id and m.problem is null
        and (select count(*) from jsonb_each(to_jsonb(m) - 'legacy_id' - 'problem') e where to_jsonb(p) -> e.key is distinct from e.value) > 0;
  end if;

  -- ── items (mapped) ──
  create temp table _mi on commit drop as
  select i.id as legacy_id,
         (select pr.id from projects pr where nullif(btrim(i.proyecto), '') is not null and opsboard_norm(pr.name) = opsboard_norm(i.proyecto) limit 1) as project_id,
         i.tema as title, coalesce(i.objetivo, '') as description, coalesce(i.notas, '') as notes,
         (select s.id from statuses s where s.project_id is null and s.key = f1d_status_key(i.status)) as status_id,
         f1d_prio_pm(nullif(btrim(i.prioridad), '')) as priority,
         (select id from people x where opsboard_norm(x.name) = opsboard_norm(i.propietario) limit 1) as assignee_id,
         f1d_date(i.fecha_inicio) as start_date, f1d_date(i.fecha_fin) as due_date,
         case when nullif(btrim(i.category), '') is null then '{}'::text[] else array[i.category] end as tags,
         i.risk as risk, coalesce(i.subtareas, '[]'::jsonb) as legacy_subtareas,
         jsonb_build_object('estado_sheet', i.estado_sheet, 'archivos', i.archivos, 'category', i.category, 'proyecto', i.proyecto) as legacy,
         i.created_at as created_at, i.updated_at as legacy_updated_at,
         case when nullif(btrim(i.tema), '') is null then 'title_empty'
              when i.status is null or i.status not in ('pending','inprogress','blocked','done','backlog') then 'status_unexpected'
              when nullif(btrim(i.prioridad), '') is not null and i.prioridad not in ('P0','P1','P2','P3') then 'priority_unexpected'
              when i.risk is null or i.risk not in ('green','yellow','red') then 'risk_unexpected'
              when nullif(btrim(i.proyecto), '') is not null
                   and not exists (select 1 from projects pr where opsboard_norm(pr.name) = opsboard_norm(i.proyecto)) then 'project_unmatched'
         end as problem
  from items i;
  insert into _plan select 30, 'items', 'skip_invalid', legacy_id, jsonb_build_object('problem', problem) from _mi where problem is not null;

  insert into _plan select 31, 'items', 'insert', m.legacy_id, jsonb_build_object('title', m.title)
    from _mi m where m.problem is null and not exists (select 1 from work_items w where w.legacy_source = 'items' and w.legacy_id = m.legacy_id);
  insert into _plan select 32, 'items', 'update', m.legacy_id,
         (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(m) - 'legacy_id' - 'problem' - 'created_at' - 'legacy_updated_at') e where to_jsonb(w) -> e.key is distinct from e.value)
    from _mi m join work_items w on w.legacy_source = 'items' and w.legacy_id = m.legacy_id
    where m.problem is null
      and (select count(*) from jsonb_each(to_jsonb(m) - 'legacy_id' - 'problem' - 'created_at' - 'legacy_updated_at') e where to_jsonb(w) -> e.key is distinct from e.value) > 0;
  -- items present in pm but gone from legacy (or now invalid-and-skipped are NOT deleted): only true deletions
  insert into _plan select 33, 'items', 'delete', w.legacy_id, jsonb_build_object('title', w.title)
    from work_items w where w.legacy_source = 'items' and not exists (select 1 from items i where i.id = w.legacy_id);

  if p_apply then
    insert into work_items (legacy_source, legacy_id, type, project_id, title, description, notes, status_id, priority, assignee_id, start_date, due_date, tags, risk, created_at, updated_at, legacy_subtareas, legacy)
      select 'items', m.legacy_id, 'topic', m.project_id, m.title, m.description, m.notes, m.status_id, m.priority, m.assignee_id, m.start_date, m.due_date, m.tags, m.risk,
             coalesce(m.created_at, now()), coalesce(m.legacy_updated_at, now()), m.legacy_subtareas, m.legacy
      from _mi m where m.problem is null and not exists (select 1 from work_items w where w.legacy_source = 'items' and w.legacy_id = m.legacy_id);
    update work_items w set project_id = m.project_id, title = m.title, description = m.description, notes = m.notes, status_id = m.status_id, priority = m.priority,
           assignee_id = m.assignee_id, start_date = m.start_date, due_date = m.due_date, tags = m.tags, risk = m.risk,
           legacy_subtareas = m.legacy_subtareas, legacy = m.legacy
      from _mi m where w.legacy_source = 'items' and w.legacy_id = m.legacy_id and m.problem is null
        and (select count(*) from jsonb_each(to_jsonb(m) - 'legacy_id' - 'problem' - 'created_at' - 'legacy_updated_at') e where to_jsonb(w) -> e.key is distinct from e.value) > 0;
    insert into activity_events (entity_type, entity_id, action, old_value)
      select 'work_item', w.id, 'f1d_sync:delete', to_jsonb(w) from work_items w
      where w.legacy_source = 'items' and not exists (select 1 from items i where i.id = w.legacy_id);
    delete from work_items w where w.legacy_source = 'items' and not exists (select 1 from items i where i.id = w.legacy_id);
  end if;

  -- ── hitos -> milestones ──
  create temp table _mh on commit drop as
  select h.id as legacy_id, pr.id as project_id, h.nombre as title, coalesce(h.descripcion, '') as description,
         (select s.id from statuses s where s.project_id is null and s.key = case when h.completado then 'done' else 'planned' end) as status_id,
         f1d_date(h.fecha_prevista) as due_date,
         jsonb_build_object('orden', h.orden, 'completado', h.completado) as legacy,
         h.created_at as created_at,
         case when nullif(btrim(h.nombre), '') is null then 'title_empty' when pr.id is null then 'project_missing' end as problem
  from hitos h left join projects pr on pr.legacy_id = h.proyecto_id;
  insert into _plan select 40, 'hitos', 'skip_invalid', legacy_id, jsonb_build_object('problem', problem) from _mh where problem is not null;
  insert into _plan select 41, 'hitos', 'insert', m.legacy_id, jsonb_build_object('title', m.title)
    from _mh m where m.problem is null and not exists (select 1 from work_items w where w.legacy_source = 'hitos' and w.legacy_id = m.legacy_id);
  insert into _plan select 42, 'hitos', 'update', m.legacy_id,
         (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(m) - 'legacy_id' - 'problem' - 'created_at') e where to_jsonb(w) -> e.key is distinct from e.value)
    from _mh m join work_items w on w.legacy_source = 'hitos' and w.legacy_id = m.legacy_id
    where m.problem is null and (select count(*) from jsonb_each(to_jsonb(m) - 'legacy_id' - 'problem' - 'created_at') e where to_jsonb(w) -> e.key is distinct from e.value) > 0;
  insert into _plan select 43, 'hitos', 'delete', w.legacy_id, jsonb_build_object('title', w.title)
    from work_items w where w.legacy_source = 'hitos' and not exists (select 1 from hitos h where h.id = w.legacy_id);
  if p_apply then
    insert into work_items (legacy_source, legacy_id, type, project_id, title, description, status_id, due_date, tags, created_at, legacy)
      select 'hitos', m.legacy_id, 'milestone', m.project_id, m.title, m.description, m.status_id, m.due_date, '{}', coalesce(m.created_at, now()), m.legacy
      from _mh m where m.problem is null and not exists (select 1 from work_items w where w.legacy_source = 'hitos' and w.legacy_id = m.legacy_id);
    update work_items w set project_id = m.project_id, title = m.title, description = m.description, status_id = m.status_id, due_date = m.due_date, legacy = m.legacy
      from _mh m where w.legacy_source = 'hitos' and w.legacy_id = m.legacy_id and m.problem is null
        and (select count(*) from jsonb_each(to_jsonb(m) - 'legacy_id' - 'problem' - 'created_at') e where to_jsonb(w) -> e.key is distinct from e.value) > 0;
    delete from work_items w where w.legacy_source = 'hitos' and not exists (select 1 from hitos h where h.id = w.legacy_id);
  end if;

  -- ── comentarios -> comments ──
  create temp table _mc on commit drop as
  select 'comentarios:' || c.id as legacy_ref, c.id as legacy_id, w.id as work_item_id, case when w.id is null then p.id end as project_id,
         c.texto as body, c.created_at,
         case when w.id is null and p.id is null then 'target_missing' end as problem
  from comentarios c
  left join work_items w on w.legacy_source = 'items' and w.legacy_id = c.item_id
  left join projects p on c.item_id is null and p.legacy_id = c.proyecto_id;
  insert into _plan select 50, 'comentarios', 'skip_invalid', legacy_id, jsonb_build_object('problem', problem) from _mc where problem is not null;
  insert into _plan select 51, 'comentarios', 'insert', m.legacy_id, null
    from _mc m where m.problem is null and not exists (select 1 from comments c where c.legacy_ref = m.legacy_ref);
  insert into _plan select 52, 'comentarios', 'update', m.legacy_id, jsonb_build_object('body', m.body)
    from _mc m join comments c on c.legacy_ref = m.legacy_ref where m.problem is null and c.body is distinct from m.body;
  insert into _plan select 53, 'comentarios', 'delete', substr(c.legacy_ref, 13), null
    from comments c where c.legacy_ref like 'comentarios:%' and not exists (select 1 from comentarios x where 'comentarios:' || x.id = c.legacy_ref);
  if p_apply then
    insert into comments (work_item_id, project_id, body, legacy_ref, created_at)
      select m.work_item_id, m.project_id, m.body, m.legacy_ref, coalesce(m.created_at, now())
      from _mc m where m.problem is null and not exists (select 1 from comments c where c.legacy_ref = m.legacy_ref);
    update comments c set body = m.body from _mc m where c.legacy_ref = m.legacy_ref and m.problem is null and c.body is distinct from m.body;
    delete from comments c where c.legacy_ref like 'comentarios:%' and not exists (select 1 from comentarios x where 'comentarios:' || x.id = c.legacy_ref);
  end if;

  -- ── projects deleted in legacy (after items were re-pointed) ──
  insert into _plan select 60, 'projects', 'delete', p.legacy_id, jsonb_build_object('name', p.name)
    from projects p where p.legacy_id is not null and not exists (select 1 from proyectos l where l.id = p.legacy_id);
  if p_apply then
    insert into activity_events (entity_type, entity_id, action, old_value)
      select 'project', p.id, 'f1d_sync:delete', to_jsonb(p) from projects p where p.legacy_id is not null and not exists (select 1 from proyectos l where l.id = p.legacy_id);
    delete from projects p where p.legacy_id is not null and not exists (select 1 from proyectos l where l.id = p.legacy_id);
  end if;

  if p_apply then
    insert into activity_events (entity_type, entity_id, action, new_value)
      select 'sync', gen_random_uuid(), 'f1d_sync:apply', jsonb_build_object('summary', (select jsonb_object_agg(k, n) from (select entity || '.' || action k, count(*) n from _plan group by 1) s));
  end if;

  return query select pl.entity, pl.action, pl.legacy_id, pl.detail from _plan pl order by pl.ord, pl.legacy_id;
end $$;

-- ================================================================
-- pm -> legacy  (ROLLBACK ONLY)
-- ================================================================
create or replace function f1d_reverse(p_apply boolean default false)
returns table (entity text, action text, legacy_id text, detail jsonb)
language plpgsql as $$
#variable_conflict use_column
begin
  drop table if exists _rplan, _rp, _ri;
  create temp table _rplan (ord int, entity text, action text, legacy_id text, detail jsonb) on commit drop;

  -- ── projects ──
  create temp table _rp on commit drop as
  select p.id as pm_id, p.legacy_id, p.name, coalesce(p.name_en, '') as nombre_en, p.description as descripcion,
         coalesce((select pe.name from people pe where pe.id = p.owner_id), '') as propietario,
         f1d_prio_legacy(p.priority) as prioridad,
         coalesce(p.legacy_status, f1d_pstatus_legacy(p.status)) as status,
         coalesce(p.legacy_estado, '') as estado,
         f1d_ts(p.start_date) as fecha_inicio, f1d_ts(p.target_date) as fecha_fin,
         p.fase, p.capex, p.desarrollo, p.notes as notas
  from projects p;
  insert into _rplan select 20, 'proyectos', 'insert', coalesce(r.legacy_id, ''), jsonb_build_object('name', r.name) from _rp r where r.legacy_id is null or not exists (select 1 from proyectos l where l.id = r.legacy_id);
  insert into _rplan select 21, 'proyectos', 'update', r.legacy_id,
         jsonb_strip_nulls(jsonb_build_object(
           'nombre', case when l.nombre is distinct from r.name then r.name end,
           'nombre_en', case when coalesce(l.nombre_en, '') is distinct from r.nombre_en then r.nombre_en end,
           'descripcion', case when coalesce(l.descripcion, '') is distinct from r.descripcion then r.descripcion end,
           'propietario', case when opsboard_norm(l.propietario) is distinct from opsboard_norm(r.propietario) then r.propietario end,
           'prioridad', case when coalesce(l.prioridad, '') is distinct from r.prioridad then r.prioridad end,
           'status', case when l.status is distinct from r.status then r.status end,
           'fecha_inicio', case when f1d_date(l.fecha_inicio) is distinct from f1d_date(r.fecha_inicio) then r.fecha_inicio end,
           'fecha_fin', case when f1d_date(l.fecha_fin) is distinct from f1d_date(r.fecha_fin) then r.fecha_fin end,
           'fase', case when coalesce(l.fase, '') is distinct from r.fase then r.fase end,
           'capex', case when l.capex is distinct from r.capex then r.capex end,
           'desarrollo', case when coalesce(l.desarrollo, '') is distinct from r.desarrollo then r.desarrollo end,
           'notas', case when coalesce(l.notas, '') is distinct from r.notas then r.notas end))
    from _rp r join proyectos l on l.id = r.legacy_id
    where l.nombre is distinct from r.name or coalesce(l.nombre_en, '') is distinct from r.nombre_en or coalesce(l.descripcion, '') is distinct from r.descripcion
       or opsboard_norm(l.propietario) is distinct from opsboard_norm(r.propietario) or coalesce(l.prioridad, '') is distinct from r.prioridad
       or l.status is distinct from r.status or f1d_date(l.fecha_inicio) is distinct from f1d_date(r.fecha_inicio) or f1d_date(l.fecha_fin) is distinct from f1d_date(r.fecha_fin)
       or coalesce(l.fase, '') is distinct from r.fase or l.capex is distinct from r.capex or coalesce(l.desarrollo, '') is distinct from r.desarrollo
       or coalesce(l.notas, '') is distinct from r.notas;
  insert into _rplan select 22, 'proyectos', 'delete', l.id, jsonb_build_object('nombre', l.nombre)
    from proyectos l where not exists (select 1 from projects p where p.legacy_id = l.id);

  if p_apply then
    -- new pm projects get a legacy id and a legacy row
    update projects p set legacy_id = f1d_newid() where p.legacy_id is null;
    insert into proyectos (id, nombre, nombre_en, descripcion, propietario, prioridad, estado, status, desarrollo, fecha_inicio, fecha_fin, notas, fase, capex)
      select p.legacy_id, p.name, coalesce(p.name_en, ''), p.description, coalesce((select pe.name from people pe where pe.id = p.owner_id), ''),
             f1d_prio_legacy(p.priority), coalesce(p.legacy_estado, ''), coalesce(p.legacy_status, f1d_pstatus_legacy(p.status)), p.desarrollo,
             f1d_ts(p.start_date), f1d_ts(p.target_date), p.notes, p.fase, p.capex
      from projects p where not exists (select 1 from proyectos l where l.id = p.legacy_id);
    update proyectos l set nombre = r.name, nombre_en = r.nombre_en, descripcion = r.descripcion, propietario = r.propietario, prioridad = r.prioridad, status = r.status,
           fecha_inicio = case when f1d_date(l.fecha_inicio) is not distinct from f1d_date(r.fecha_inicio) then l.fecha_inicio else r.fecha_inicio end,
           fecha_fin = case when f1d_date(l.fecha_fin) is not distinct from f1d_date(r.fecha_fin) then l.fecha_fin else r.fecha_fin end,
           fase = r.fase, capex = r.capex, desarrollo = r.desarrollo, notas = r.notas
      from (select p.legacy_id, p.name, coalesce(p.name_en, '') as nombre_en, p.description as descripcion, coalesce((select pe.name from people pe where pe.id = p.owner_id), '') as propietario,
                   f1d_prio_legacy(p.priority) as prioridad, coalesce(p.legacy_status, f1d_pstatus_legacy(p.status)) as status,
                   f1d_ts(p.start_date) as fecha_inicio, f1d_ts(p.target_date) as fecha_fin, p.fase, p.capex, p.desarrollo, p.notes as notas from projects p) r
      where l.id = r.legacy_id
        and (l.nombre is distinct from r.name or coalesce(l.nombre_en, '') is distinct from r.nombre_en or coalesce(l.descripcion, '') is distinct from r.descripcion
          or opsboard_norm(l.propietario) is distinct from opsboard_norm(r.propietario) or coalesce(l.prioridad, '') is distinct from r.prioridad
          or l.status is distinct from r.status or f1d_date(l.fecha_inicio) is distinct from f1d_date(r.fecha_inicio) or f1d_date(l.fecha_fin) is distinct from f1d_date(r.fecha_fin)
          or coalesce(l.fase, '') is distinct from r.fase or l.capex is distinct from r.capex or coalesce(l.desarrollo, '') is distinct from r.desarrollo
          or coalesce(l.notas, '') is distinct from r.notas);
  end if;

  -- ── items (any pm work item of type != milestone becomes a legacy item) ──
  create temp table _ri on commit drop as
  select w.id as pm_id, w.legacy_id, w.title as tema, w.description as objetivo,
         coalesce(w.tags[1], w.legacy ->> 'category', 'projects') as category,
         coalesce((select pe.name from people pe where pe.id = w.assignee_id), '') as propietario,
         f1d_prio_legacy(w.priority) as prioridad, coalesce(w.risk, 'green') as risk,
         f1d_status_legacy(s.key) as status,
         f1d_ts(w.start_date) as fecha_inicio, f1d_ts(w.due_date) as fecha_fin,
         coalesce(w.legacy ->> 'archivos', '') as archivos, w.notes as notas,
         coalesce((select pr.name from projects pr where pr.id = w.project_id), '') as proyecto,
         w.legacy_subtareas as subtareas, w.legacy ->> 'estado_sheet' as estado_sheet_prev
  from work_items w join statuses s on s.id = w.status_id
  where w.type <> 'milestone';
  insert into _rplan select 30, 'items', 'insert', coalesce(r.legacy_id, ''), jsonb_build_object('tema', r.tema) from _ri r where r.legacy_id is null or not exists (select 1 from items l where l.id = r.legacy_id);
  insert into _rplan select 31, 'items', 'update', r.legacy_id, jsonb_build_object('changed', (select jsonb_agg(c) from unnest(array[
           case when l.tema is distinct from r.tema then 'tema' end,
           case when coalesce(l.objetivo, '') is distinct from r.objetivo then 'objetivo' end,
           case when opsboard_norm(l.propietario) is distinct from opsboard_norm(r.propietario) then 'propietario' end,
           case when coalesce(l.prioridad, '') is distinct from r.prioridad then 'prioridad' end,
           case when l.risk is distinct from r.risk then 'risk' end,
           case when l.status is distinct from r.status then 'status' end,
           case when f1d_date(l.fecha_inicio) is distinct from f1d_date(r.fecha_inicio) then 'fecha_inicio' end,
           case when f1d_date(l.fecha_fin) is distinct from f1d_date(r.fecha_fin) then 'fecha_fin' end,
           case when coalesce(l.notas, '') is distinct from r.notas then 'notas' end,
           case when opsboard_norm(l.proyecto) is distinct from opsboard_norm(r.proyecto) then 'proyecto' end,
           case when coalesce(l.subtareas, '[]'::jsonb) is distinct from r.subtareas then 'subtareas' end,
           case when coalesce(l.category, '') is distinct from r.category then 'category' end]) c where c is not null))
    from _ri r join items l on l.id = r.legacy_id
    where l.tema is distinct from r.tema or coalesce(l.objetivo, '') is distinct from r.objetivo or opsboard_norm(l.propietario) is distinct from opsboard_norm(r.propietario)
       or coalesce(l.prioridad, '') is distinct from r.prioridad or l.risk is distinct from r.risk or l.status is distinct from r.status
       or f1d_date(l.fecha_inicio) is distinct from f1d_date(r.fecha_inicio) or f1d_date(l.fecha_fin) is distinct from f1d_date(r.fecha_fin)
       or coalesce(l.notas, '') is distinct from r.notas or opsboard_norm(l.proyecto) is distinct from opsboard_norm(r.proyecto)
       or coalesce(l.subtareas, '[]'::jsonb) is distinct from r.subtareas or coalesce(l.category, '') is distinct from r.category;
  insert into _rplan select 32, 'items', 'delete', l.id, jsonb_build_object('tema', l.tema)
    from items l where not exists (select 1 from work_items w where w.legacy_source = 'items' and w.legacy_id = l.id);

  if p_apply then
    update work_items w set legacy_source = 'items', legacy_id = f1d_newid() where w.legacy_id is null and w.type <> 'milestone';
    insert into items (id, tema, objetivo, category, propietario, prioridad, risk, status, estado_sheet, fecha_inicio, fecha_fin, archivos, notas, proyecto, subtareas)
      select w.legacy_id, w.title, w.description, coalesce(w.tags[1], 'projects'), coalesce((select pe.name from people pe where pe.id = w.assignee_id), ''),
             f1d_prio_legacy(w.priority), coalesce(w.risk, 'green'), f1d_status_legacy(s.key), f1d_estado_sheet(f1d_status_legacy(s.key)),
             f1d_ts(w.start_date), f1d_ts(w.due_date), coalesce(w.legacy ->> 'archivos', ''), w.notes,
             coalesce((select pr.name from projects pr where pr.id = w.project_id), ''), w.legacy_subtareas
      from work_items w join statuses s on s.id = w.status_id
      where w.type <> 'milestone' and not exists (select 1 from items l where l.id = w.legacy_id);
    update items l set tema = r.tema, objetivo = r.objetivo, category = r.category, propietario = r.propietario, prioridad = r.prioridad, risk = r.risk,
           estado_sheet = case when l.status is distinct from r.status then f1d_estado_sheet(r.status) else l.estado_sheet end,
           status = r.status,
           fecha_inicio = case when f1d_date(l.fecha_inicio) is not distinct from f1d_date(r.fecha_inicio) then l.fecha_inicio else r.fecha_inicio end,
           fecha_fin = case when f1d_date(l.fecha_fin) is not distinct from f1d_date(r.fecha_fin) then l.fecha_fin else r.fecha_fin end,
           notas = r.notas, proyecto = r.proyecto, subtareas = r.subtareas
      from (select w.legacy_id, w.title as tema, w.description as objetivo, coalesce(w.tags[1], w.legacy ->> 'category', 'projects') as category,
                   coalesce((select pe.name from people pe where pe.id = w.assignee_id), '') as propietario, f1d_prio_legacy(w.priority) as prioridad,
                   coalesce(w.risk, 'green') as risk, f1d_status_legacy(s.key) as status, f1d_ts(w.start_date) as fecha_inicio, f1d_ts(w.due_date) as fecha_fin,
                   w.notes as notas, coalesce((select pr.name from projects pr where pr.id = w.project_id), '') as proyecto, w.legacy_subtareas as subtareas
            from work_items w join statuses s on s.id = w.status_id where w.type <> 'milestone') r
      where l.id = r.legacy_id
        and (l.tema is distinct from r.tema or coalesce(l.objetivo, '') is distinct from r.objetivo or opsboard_norm(l.propietario) is distinct from opsboard_norm(r.propietario)
          or coalesce(l.prioridad, '') is distinct from r.prioridad or l.risk is distinct from r.risk or l.status is distinct from r.status
          or f1d_date(l.fecha_inicio) is distinct from f1d_date(r.fecha_inicio) or f1d_date(l.fecha_fin) is distinct from f1d_date(r.fecha_fin)
          or coalesce(l.notas, '') is distinct from r.notas or opsboard_norm(l.proyecto) is distinct from opsboard_norm(r.proyecto)
          or coalesce(l.subtareas, '[]'::jsonb) is distinct from r.subtareas or coalesce(l.category, '') is distinct from r.category);
    delete from items l where not exists (select 1 from work_items w where w.legacy_source = 'items' and w.legacy_id = l.id);
    delete from proyectos l where not exists (select 1 from projects p where p.legacy_id = l.id);
  end if;

  -- ── milestones <-> hitos, project comments <-> comentarios (insert / update / delete) ──
  insert into _rplan select 40, 'hitos', 'insert', coalesce(w.legacy_id, ''), jsonb_build_object('title', w.title) from work_items w where w.type = 'milestone' and (w.legacy_id is null or not exists (select 1 from hitos h where h.id = w.legacy_id));
  insert into _rplan select 42, 'hitos', 'delete', h.id, null from hitos h where not exists (select 1 from work_items w where w.legacy_source = 'hitos' and w.legacy_id = h.id);
  insert into _rplan select 50, 'comentarios', 'insert', coalesce(substr(c.legacy_ref, 13), ''), null from comments c where c.project_id is not null and (c.legacy_ref is null or not exists (select 1 from comentarios x where 'comentarios:' || x.id = c.legacy_ref));
  insert into _rplan select 52, 'comentarios', 'delete', x.id, null from comentarios x where x.item_id is null and not exists (select 1 from comments c where c.legacy_ref = 'comentarios:' || x.id);
  if p_apply then
    update work_items w set legacy_source = 'hitos', legacy_id = f1d_newid() where w.type = 'milestone' and w.legacy_id is null;
    insert into hitos (id, proyecto_id, nombre, descripcion, fecha_prevista, completado, orden)
      select w.legacy_id, p.legacy_id, w.title, w.description, f1d_ts(w.due_date), (s.category = 'DONE'), coalesce((w.legacy ->> 'orden')::int, 0)
      from work_items w join statuses s on s.id = w.status_id join projects p on p.id = w.project_id
      where w.type = 'milestone' and not exists (select 1 from hitos h where h.id = w.legacy_id);
    update hitos h set nombre = w.title, descripcion = w.description, completado = (s.category = 'DONE'),
           fecha_prevista = case when f1d_date(h.fecha_prevista) is not distinct from w.due_date then h.fecha_prevista else f1d_ts(w.due_date) end
      from work_items w join statuses s on s.id = w.status_id
      where w.legacy_source = 'hitos' and w.legacy_id = h.id
        and (h.nombre is distinct from w.title or coalesce(h.descripcion, '') is distinct from w.description or h.completado is distinct from (s.category = 'DONE')
          or f1d_date(h.fecha_prevista) is distinct from w.due_date);
    delete from hitos h where not exists (select 1 from work_items w where w.legacy_source = 'hitos' and w.legacy_id = h.id);
    update comments c set legacy_ref = 'comentarios:' || f1d_newid() where c.project_id is not null and c.legacy_ref is null;
    insert into comentarios (id, proyecto_id, item_id, texto, ts)
      select substr(c.legacy_ref, 13), p.legacy_id, null, c.body, to_char(c.created_at at time zone 'Europe/Madrid', 'DD/MM/YYYY, HH24:MI:SS')
      from comments c join projects p on p.id = c.project_id
      where c.project_id is not null and not exists (select 1 from comentarios x where 'comentarios:' || x.id = c.legacy_ref);
    delete from comentarios x where x.item_id is null and not exists (select 1 from comments c where c.legacy_ref = 'comentarios:' || x.id);
  end if;

  return query select pl.entity, pl.action, pl.legacy_id, pl.detail from _rplan pl order by pl.ord, pl.legacy_id;
end $$;

comment on function f1d_sync(boolean) is 'legacy -> pm. Dry-run unless apply=true. Pre-cutover only.';
comment on function f1d_reverse(boolean) is 'pm -> legacy. ROLLBACK ONLY. Dry-run unless apply=true.';
