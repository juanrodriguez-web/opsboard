-- ================================================================
-- OpsBoard F1B — legacy → PM model data migration
-- Idempotent: safe to run many times. Existing migrated rows are NEVER overwritten
-- (ON CONFLICT DO NOTHING); legacy tables are only read.
-- Rows with a BLOCKING exception are NOT migrated; they are listed in migration_exceptions.
-- Blank values are not "fixed": blank project => project_id NULL (INFO), blank owner => NULL (INFO).
-- NOT applied to remote. Run only against local/dev.
-- ================================================================
begin;

-- The exception report is derived state: rebuild it on every run.
delete from migration_exceptions;

-- ── Stage legacy rows with resolved references ───────────────────
create temp table _p on commit drop as
select p.*,
       opsboard_norm(p.nombre) as nn,
       (select pe.id from people pe where opsboard_norm(pe.name) = opsboard_norm(p.propietario) limit 1) as owner_pid
from proyectos p;

-- ── PROJECT exceptions ───────────────────────────────────────────
insert into migration_exceptions (severity, code, entity, legacy_id, detail)
select 'BLOCKING', 'PROJECT_OWNER_UNKNOWN', 'proyectos', id, jsonb_build_object('propietario', propietario)
  from _p where nullif(btrim(propietario), '') is not null and owner_pid is null
union all
select 'BLOCKING', 'PROJECT_STATUS_UNEXPECTED', 'proyectos', id, jsonb_build_object('status', status)
  from _p where status is null or status not in ('pending','inprogress','blocked','done','backlog')
union all
select 'BLOCKING', 'PROJECT_PRIORITY_UNEXPECTED', 'proyectos', id, jsonb_build_object('prioridad', prioridad)
  from _p where nullif(btrim(prioridad), '') is not null and prioridad not in ('P0','P1','P2','P3')
union all
select 'BLOCKING', 'PROJECT_NAME_EMPTY', 'proyectos', id, '{}'::jsonb from _p where nn = ''
union all
select 'BLOCKING', 'PROJECT_NAME_DUPLICATE', 'proyectos', id, jsonb_build_object('nombre', nombre)
  from _p where nn <> '' and nn in (select nn from _p group by nn having count(*) > 1)
union all
select 'WARN', 'PROJECT_NAME_WHITESPACE', 'proyectos', id, jsonb_build_object('nombre', nombre)
  from _p where nombre ~ '[\t\r\n]' or nombre <> btrim(nombre)
union all
select 'WARN', 'PROJECT_FASE_UNKNOWN', 'proyectos', id, jsonb_build_object('fase', fase)
  from _p where nullif(btrim(fase), '') is not null
   and opsboard_norm(fase) not in ('rtm','viabilidad','business case','comite de capex','desarrollo')
union all
select 'WARN', 'PROJECT_DATE_ORDER', 'proyectos', id, jsonb_build_object('fecha_inicio', fecha_inicio, 'fecha_fin', fecha_fin)
  from _p where fecha_inicio is not null and fecha_fin is not null and fecha_fin < fecha_inicio
union all
select 'INFO', 'PROJECT_STATUS_MAPPING_ASSUMPTION', 'proyectos', id,
       jsonb_build_object('legacy_status', status,
         'mapped_to', case status when 'blocked' then 'status=active, health=at_risk' else 'status=planning (legacy_status kept)' end)
  from _p where status in ('blocked','backlog')
union all
select 'INFO', 'PROJECT_WITHOUT_ITEMS', 'proyectos', p.id, jsonb_build_object('nombre', p.nombre)
  from _p p where not exists (select 1 from items i where opsboard_norm(i.proyecto) = p.nn);

create temp table _pheld on commit drop as
select distinct legacy_id as lid from migration_exceptions where entity = 'proyectos' and severity = 'BLOCKING';

-- ── PROJECTS ─────────────────────────────────────────────────────
insert into projects (legacy_id, name, name_en, description, owner_id, status, health, priority,
                      start_date, target_date, progress_mode, fase, capex, desarrollo, notes,
                      legacy_status, legacy_estado, created_at, updated_at)
select p.id, p.nombre, nullif(p.nombre_en, ''), coalesce(p.descripcion, ''), p.owner_pid,
       case p.status when 'pending' then 'planning' when 'backlog' then 'planning'
                     when 'inprogress' then 'active' when 'blocked' then 'active' when 'done' then 'completed' end,
       case p.status when 'blocked' then 'at_risk' else 'not_set' end,
       case p.prioridad when 'P0' then 'urgent' when 'P1' then 'high' when 'P2' then 'medium' when 'P3' then 'low' end,
       (p.fecha_inicio at time zone 'Europe/Madrid')::date, (p.fecha_fin at time zone 'Europe/Madrid')::date, 'calculated',
       coalesce(p.fase, ''), p.capex, coalesce(p.desarrollo, ''), coalesce(p.notas, ''),
       p.status, p.estado, coalesce(p.created_at, now()), coalesce(p.updated_at, now())
from _p p
where p.id not in (select lid from _pheld)
on conflict (legacy_id) do nothing;

-- ── Stage items ──────────────────────────────────────────────────
create temp table _i on commit drop as
select i.*,
       (select pe.id from people pe where opsboard_norm(pe.name) = opsboard_norm(i.propietario) limit 1) as owner_pid,
       (select count(*) from _p where _p.nn = opsboard_norm(i.proyecto))                                   as pmatch,
       (select _p.id from _p where _p.nn = opsboard_norm(i.proyecto) limit 1)                              as plid
from items i;

insert into migration_exceptions (severity, code, entity, legacy_id, detail)
select 'BLOCKING', 'ITEM_STATUS_UNEXPECTED', 'items', id, jsonb_build_object('status', status)
  from _i where status is null or status not in ('pending','inprogress','blocked','done','backlog')
union all
select 'BLOCKING', 'ITEM_PRIORITY_UNEXPECTED', 'items', id, jsonb_build_object('prioridad', prioridad)
  from _i where nullif(btrim(prioridad), '') is not null and prioridad not in ('P0','P1','P2','P3')
union all
select 'BLOCKING', 'ITEM_RISK_UNEXPECTED', 'items', id, jsonb_build_object('risk', risk)
  from _i where risk is null or risk not in ('green','yellow','red')
union all
select 'BLOCKING', 'ITEM_TITLE_EMPTY', 'items', id, '{}'::jsonb from _i where nullif(btrim(tema), '') is null
union all
select 'BLOCKING', 'ITEM_OWNER_UNKNOWN', 'items', id, jsonb_build_object('propietario', propietario)
  from _i where nullif(btrim(propietario), '') is not null and owner_pid is null
union all
select 'BLOCKING', 'ITEM_PROJECT_UNMATCHED', 'items', id, jsonb_build_object('proyecto', proyecto)
  from _i where nullif(btrim(proyecto), '') is not null and pmatch = 0
union all
select 'BLOCKING', 'ITEM_PROJECT_AMBIGUOUS', 'items', id, jsonb_build_object('proyecto', proyecto)
  from _i where pmatch > 1
union all
select 'BLOCKING', 'ITEM_PROJECT_HELD', 'items', id, jsonb_build_object('proyecto', proyecto)
  from _i where plid in (select lid from _pheld)
union all
select 'WARN', 'ITEM_CATEGORY_UNEXPECTED', 'items', id, jsonb_build_object('category', category)
  from _i where category is not null and category not in ('projects','product','tools','cvm')
union all
select 'WARN', 'ITEM_DATE_ORDER', 'items', id, jsonb_build_object('fecha_inicio', fecha_inicio, 'fecha_fin', fecha_fin)
  from _i where fecha_inicio is not null and fecha_fin is not null and fecha_fin < fecha_inicio
union all
select 'WARN', 'ITEM_ESTADO_SHEET_MISMATCH', 'items', id,
       jsonb_build_object('status', status, 'estado_sheet', estado_sheet)
  from _i where status in ('pending','inprogress','blocked','done','backlog')
   and opsboard_norm(estado_sheet) <> case status when 'pending' then 'no iniciado' when 'inprogress' then 'segun lo planificado'
        when 'blocked' then 'en peligro' when 'done' then 'hecho' when 'backlog' then 'no iniciado' end
union all
select 'WARN', 'ITEM_SUBTAREAS_SHAPE', 'items', id, jsonb_build_object('subtareas', subtareas)
  from _i where subtareas is not null and (jsonb_typeof(subtareas) <> 'array'
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(subtareas) = 'array' then subtareas else '[]'::jsonb end) e
                where jsonb_typeof(e) <> 'object' or not (e ? 'id' and e ? 'title' and e ? 'status')))
union all
select 'INFO', 'ITEM_NO_PROJECT', 'items', id, '{}'::jsonb from _i where nullif(btrim(proyecto), '') is null
union all
select 'INFO', 'ITEM_OWNER_EMPTY', 'items', id, '{}'::jsonb from _i where nullif(btrim(propietario), '') is null
union all
select 'INFO', 'ITEM_DONE_COMPLETED_AT_NOT_SET', 'items', id,
       jsonb_build_object('note', 'no trustworthy completion date in DB; done_ts lives in browser localStorage')
  from _i where status = 'done';

-- ── WORK ITEMS (type topic) ──────────────────────────────────────
insert into work_items (legacy_source, legacy_id, type, project_id, title, description, notes, status_id, priority,
                        assignee_id, start_date, due_date, tags, risk, created_at, updated_at,
                        legacy_subtareas, legacy)
select 'items', i.id, 'topic',
       (select pr.id from projects pr where pr.legacy_id = i.plid),
       i.tema, coalesce(i.objetivo, ''), coalesce(i.notas, ''),
       (select s.id from statuses s where s.project_id is null and s.key =
          case i.status when 'pending' then 'planned' when 'inprogress' then 'in_progress' when 'blocked' then 'blocked'
                        when 'done' then 'done' when 'backlog' then 'backlog' end),
       case i.prioridad when 'P0' then 'urgent' when 'P1' then 'high' when 'P2' then 'medium' when 'P3' then 'low' end,
       i.owner_pid,
       (i.fecha_inicio at time zone 'Europe/Madrid')::date, (i.fecha_fin at time zone 'Europe/Madrid')::date,
       case when nullif(btrim(i.category), '') is null then '{}'::text[] else array[i.category] end,
       i.risk, coalesce(i.created_at, now()), coalesce(i.updated_at, now()),
       coalesce(i.subtareas, '[]'::jsonb),
       jsonb_build_object('estado_sheet', i.estado_sheet, 'archivos', i.archivos, 'category', i.category, 'proyecto', i.proyecto)
from _i i
where not exists (select 1 from migration_exceptions e
                  where e.entity = 'items' and e.legacy_id = i.id and e.severity = 'BLOCKING')
on conflict (legacy_source, legacy_id) do nothing;

-- ── HITOS → milestones ───────────────────────────────────────────
insert into migration_exceptions (severity, code, entity, legacy_id, detail)
select 'BLOCKING', 'HITO_PROJECT_ORPHAN', 'hitos', h.id, jsonb_build_object('proyecto_id', h.proyecto_id)
  from hitos h where not exists (select 1 from _p where _p.id = h.proyecto_id)
union all
select 'BLOCKING', 'HITO_PROJECT_HELD', 'hitos', h.id, jsonb_build_object('proyecto_id', h.proyecto_id)
  from hitos h where h.proyecto_id in (select lid from _pheld)
union all
select 'BLOCKING', 'HITO_NAME_EMPTY', 'hitos', h.id, '{}'::jsonb from hitos h where nullif(btrim(h.nombre), '') is null;

insert into work_items (legacy_source, legacy_id, type, project_id, title, description, status_id, due_date,
                        tags, created_at, updated_at, legacy)
select 'hitos', h.id, 'milestone', pr.id, h.nombre, coalesce(h.descripcion, ''),
       (select s.id from statuses s where s.project_id is null and s.key = case when h.completado then 'done' else 'planned' end),
       (h.fecha_prevista at time zone 'Europe/Madrid')::date, '{}'::text[],
       coalesce(h.created_at, now()), coalesce(h.updated_at, now()),
       jsonb_build_object('orden', h.orden, 'completado', h.completado)
from hitos h
join projects pr on pr.legacy_id = h.proyecto_id
where not exists (select 1 from migration_exceptions e where e.entity = 'hitos' and e.legacy_id = h.id and e.severity = 'BLOCKING')
on conflict (legacy_source, legacy_id) do nothing;

-- ── comentarios (DB) → comments ──────────────────────────────────
insert into migration_exceptions (severity, code, entity, legacy_id, detail)
select 'BLOCKING', 'COMMENT_TARGET_MISSING', 'comentarios', c.id,
       jsonb_build_object('item_id', c.item_id, 'proyecto_id', c.proyecto_id)
  from comentarios c
 where (c.item_id is null and c.proyecto_id is null)
    or (c.item_id is not null and not exists (select 1 from work_items w where w.legacy_source = 'items' and w.legacy_id = c.item_id))
    or (c.proyecto_id is not null and c.item_id is null and not exists (select 1 from projects p where p.legacy_id = c.proyecto_id));

insert into comments (work_item_id, project_id, body, legacy_ref, created_at)
select w.id, case when w.id is null then p.id end, c.texto, 'comentarios:' || c.id, coalesce(c.created_at, now())
from comentarios c
left join work_items w on w.legacy_source = 'items' and w.legacy_id = c.item_id
left join projects p on p.legacy_id = c.proyecto_id
where not exists (select 1 from migration_exceptions e where e.entity = 'comentarios' and e.legacy_id = c.id and e.severity = 'BLOCKING')
on conflict (legacy_ref) do nothing;

commit;

-- Summary of this run
select severity, code, count(*) as rows
from migration_exceptions group by severity, code
order by case severity when 'BLOCKING' then 1 when 'WARN' then 2 else 3 end, code;
