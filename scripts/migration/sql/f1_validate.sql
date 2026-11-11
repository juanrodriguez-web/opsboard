-- ================================================================
-- OpsBoard F1 validation — legacy vs migrated. READ-ONLY.
-- One row per check: PASS / WARN / FAIL. Final row = overall verdict.
-- Mapping tables below are written independently of the migration script.
-- ================================================================
with
m_status(l, n) as (values ('pending','planned'),('inprogress','in_progress'),('blocked','blocked'),('done','done'),('backlog','backlog')),
m_pstatus(l, n) as (values ('pending','planning'),('backlog','planning'),('inprogress','active'),('blocked','active'),('done','completed')),
m_prio(l, n) as (values ('P0','urgent'),('P1','high'),('P2','medium'),('P3','low')),
held as (select entity, legacy_id from migration_exceptions where severity = 'BLOCKING'),
li as (select * from items    where id not in (select legacy_id from held where entity = 'items')),
lp as (select * from proyectos where id not in (select legacy_id from held where entity = 'proyectos')),
lh as (select * from hitos    where id not in (select legacy_id from held where entity = 'hitos')),
wi as (select w.*, s.key as skey, s.category as scat from work_items w join statuses s on s.id = w.status_id where w.legacy_source = 'items'),
wh as (select w.*, s.key as skey from work_items w join statuses s on s.id = w.status_id where w.legacy_source = 'hitos'),
ji as (   -- legacy item joined to migrated work item
  select i.*, w.id as wid, w.title, w.description, w.notes as wnotes, w.skey, w.priority as wprio, w.risk as wrisk,
         w.start_date, w.due_date, w.tags, w.legacy_subtareas, w.legacy as wlegacy,
         w.created_at as wcreated, pr.name as pname, pe.name as ename
  from li i
  join wi w on w.legacy_id = i.id
  left join projects pr on pr.id = w.project_id
  left join people pe on pe.id = w.assignee_id),
jp as (
  select p.*, q.id as qid, q.name, q.name_en, q.description as qdesc, q.status as qstatus, q.health, q.priority as qprio,
         q.start_date as qstart, q.target_date as qtarget, q.fase as qfase, q.capex as qcapex, q.desarrollo as qdes,
         q.notes as qnotes, q.legacy_status, q.legacy_estado, q.owner_id
  from lp p join projects q on q.legacy_id = p.id),
checks(ord, chk, expected, actual, result) as (
  select 1, 'items: legacy count (minus BLOCKING exceptions) = migrated work_items',
         (select count(*) from li)::text, (select count(*) from wi)::text,
         case when (select count(*) from li) = (select count(*) from wi) then 'PASS' else 'FAIL' end
  union all select 2, 'items: no migrated work_item without a legacy row', '0',
         (select count(*) from wi where legacy_id not in (select id from items))::text,
         case when (select count(*) from wi where legacy_id not in (select id from items)) = 0 then 'PASS' else 'FAIL' end
  union all select 3, 'projects: legacy count (minus BLOCKING) = migrated projects',
         (select count(*) from lp)::text, (select count(*) from projects where legacy_id is not null)::text,
         case when (select count(*) from lp) = (select count(*) from projects where legacy_id is not null) then 'PASS' else 'FAIL' end
  union all select 4, 'hitos: legacy count (minus BLOCKING) = migrated milestones',
         (select count(*) from lh)::text, (select count(*) from wh)::text,
         case when (select count(*) from lh) = (select count(*) from wh) then 'PASS' else 'FAIL' end
  union all select 5, 'items: title identical', '0 diffs',
         (select count(*) from ji where tema is distinct from title)::text || ' diffs',
         case when (select count(*) from ji where tema is distinct from title) = 0 then 'PASS' else 'FAIL' end
  union all select 6, 'items: project link (blank legacy => NULL, else same project)', '0 diffs',
         (select count(*) from ji where opsboard_norm(proyecto) is distinct from coalesce(opsboard_norm(pname), ''))::text || ' diffs',
         case when (select count(*) from ji where opsboard_norm(proyecto) is distinct from coalesce(opsboard_norm(pname), '')) = 0 then 'PASS' else 'FAIL' end
  union all select 7, 'items: owner (blank => NULL, else same person)', '0 diffs',
         (select count(*) from ji where opsboard_norm(propietario) is distinct from coalesce(opsboard_norm(ename), ''))::text || ' diffs',
         case when (select count(*) from ji where opsboard_norm(propietario) is distinct from coalesce(opsboard_norm(ename), '')) = 0 then 'PASS' else 'FAIL' end
  union all select 8, 'items: status mapping', '0 diffs',
         (select count(*) from ji left join m_status m on m.l = ji.status where m.n is distinct from ji.skey)::text || ' diffs',
         case when (select count(*) from ji left join m_status m on m.l = ji.status where m.n is distinct from ji.skey) = 0 then 'PASS' else 'FAIL' end
  union all select 9, 'items: priority mapping (blank => NULL)', '0 diffs',
         (select count(*) from ji left join m_prio m on m.l = ji.prioridad where m.n is distinct from ji.wprio)::text || ' diffs',
         case when (select count(*) from ji left join m_prio m on m.l = ji.prioridad where m.n is distinct from ji.wprio) = 0 then 'PASS' else 'FAIL' end
  union all select 10, 'items: risk identical', '0 diffs',
         (select count(*) from ji where risk is distinct from wrisk)::text || ' diffs',
         case when (select count(*) from ji where risk is distinct from wrisk) = 0 then 'PASS' else 'FAIL' end
  union all select 11, 'items: start/due dates (Europe/Madrid calendar date of legacy timestamps)', '0 diffs',
         (select count(*) from ji where (fecha_inicio at time zone 'Europe/Madrid')::date is distinct from ji.start_date
                                     or (fecha_fin    at time zone 'Europe/Madrid')::date is distinct from ji.due_date)::text || ' diffs',
         case when (select count(*) from ji where (fecha_inicio at time zone 'Europe/Madrid')::date is distinct from ji.start_date
                                               or (fecha_fin    at time zone 'Europe/Madrid')::date is distinct from ji.due_date) = 0 then 'PASS' else 'FAIL' end
  union all select 12, 'items: subtasks preserved verbatim (total count)',
         (select coalesce(sum(jsonb_array_length(subtareas)), 0) from li where jsonb_typeof(subtareas) = 'array')::text,
         (select coalesce(sum(jsonb_array_length(legacy_subtareas)), 0) from wi)::text,
         case when (select coalesce(sum(jsonb_array_length(subtareas)), 0) from li where jsonb_typeof(subtareas) = 'array')
                 = (select coalesce(sum(jsonb_array_length(legacy_subtareas)), 0) from wi) then 'PASS' else 'FAIL' end
  union all select 13, 'items: subtasks identical per row (jsonb equality)', '0 diffs',
         (select count(*) from ji where coalesce(subtareas, '[]'::jsonb) is distinct from legacy_subtareas)::text || ' diffs',
         case when (select count(*) from ji where coalesce(subtareas, '[]'::jsonb) is distinct from legacy_subtareas) = 0 then 'PASS' else 'FAIL' end
  union all select 14, 'items: objetivo/notas/archivos/estado_sheet/category preserved', '0 diffs',
         (select count(*) from ji where coalesce(objetivo, '') is distinct from description
                                     or coalesce(notas, '')    is distinct from wnotes
                                     or coalesce(archivos, 'null') is distinct from coalesce(wlegacy->>'archivos', 'null')
                                     or estado_sheet is distinct from wlegacy->>'estado_sheet'
                                     or category     is distinct from wlegacy->>'category'
                                     or proyecto     is distinct from wlegacy->>'proyecto')::text || ' diffs',
         case when (select count(*) from ji where coalesce(objetivo, '') is distinct from description
                                     or coalesce(notas, '')    is distinct from wnotes
                                     or coalesce(archivos, 'null') is distinct from coalesce(wlegacy->>'archivos', 'null')
                                     or estado_sheet is distinct from wlegacy->>'estado_sheet'
                                     or category     is distinct from wlegacy->>'category'
                                     or proyecto     is distinct from wlegacy->>'proyecto') = 0 then 'PASS' else 'FAIL' end
  union all select 15, 'items: created_at preserved (when legacy has one)', '0 diffs',
         (select count(*) from ji where created_at is not null and created_at is distinct from wcreated)::text || ' diffs',
         case when (select count(*) from ji where created_at is not null and created_at is distinct from wcreated) = 0 then 'PASS' else 'FAIL' end
  union all select 16, 'projects: name/name_en/description/fase/capex/desarrollo/notas/legacy status+estado preserved', '0 diffs',
         (select count(*) from jp where nombre is distinct from name or coalesce(nombre_en, '') is distinct from coalesce(name_en, '')
              or coalesce(descripcion, '') is distinct from qdesc or coalesce(fase, '') is distinct from qfase
              or capex is distinct from qcapex or coalesce(desarrollo, '') is distinct from qdes
              or coalesce(notas, '') is distinct from qnotes or status is distinct from legacy_status
              or estado is distinct from legacy_estado)::text || ' diffs',
         case when (select count(*) from jp where nombre is distinct from name or coalesce(nombre_en, '') is distinct from coalesce(name_en, '')
              or coalesce(descripcion, '') is distinct from qdesc or coalesce(fase, '') is distinct from qfase
              or capex is distinct from qcapex or coalesce(desarrollo, '') is distinct from qdes
              or coalesce(notas, '') is distinct from qnotes or status is distinct from legacy_status
              or estado is distinct from legacy_estado) = 0 then 'PASS' else 'FAIL' end
  union all select 17, 'projects: status mapping, priority mapping, dates', '0 diffs',
         (select count(*) from jp left join m_pstatus s on s.l = jp.status left join m_prio m on m.l = jp.prioridad
           where s.n is distinct from qstatus or m.n is distinct from qprio
              or (fecha_inicio at time zone 'Europe/Madrid')::date is distinct from qstart
              or (fecha_fin    at time zone 'Europe/Madrid')::date is distinct from qtarget)::text || ' diffs',
         case when (select count(*) from jp left join m_pstatus s on s.l = jp.status left join m_prio m on m.l = jp.prioridad
           where s.n is distinct from qstatus or m.n is distinct from qprio
              or (fecha_inicio at time zone 'Europe/Madrid')::date is distinct from qstart
              or (fecha_fin    at time zone 'Europe/Madrid')::date is distinct from qtarget) = 0 then 'PASS' else 'FAIL' end
  union all select 18, 'projects: owner (blank => NULL, else same person)', '0 diffs',
         (select count(*) from jp left join people pe on pe.id = jp.owner_id
           where opsboard_norm(propietario) is distinct from coalesce(opsboard_norm(pe.name), ''))::text || ' diffs',
         case when (select count(*) from jp left join people pe on pe.id = jp.owner_id
           where opsboard_norm(propietario) is distinct from coalesce(opsboard_norm(pe.name), '')) = 0 then 'PASS' else 'FAIL' end
  union all select 19, 'hitos: title/due/status mapped to milestone, project link kept', '0 diffs',
         (select count(*) from lh h join wh w on w.legacy_id = h.id join projects p on p.id = w.project_id
           where h.nombre is distinct from w.title or w.type <> 'milestone' or p.legacy_id is distinct from h.proyecto_id
              or (h.fecha_prevista at time zone 'Europe/Madrid')::date is distinct from w.due_date
              or w.skey is distinct from case when h.completado then 'done' else 'planned' end)::text || ' diffs',
         case when (select count(*) from lh h join wh w on w.legacy_id = h.id join projects p on p.id = w.project_id
           where h.nombre is distinct from w.title or w.type <> 'milestone' or p.legacy_id is distinct from h.proyecto_id
              or (h.fecha_prevista at time zone 'Europe/Madrid')::date is distinct from w.due_date
              or w.skey is distinct from case when h.completado then 'done' else 'planned' end) = 0 then 'PASS' else 'FAIL' end
  union all select 20, 'completed_at: never set on a non-DONE item', '0',
         (select count(*) from wi where completed_at is not null and scat <> 'DONE')::text,
         case when (select count(*) from wi where completed_at is not null and scat <> 'DONE') = 0 then 'PASS' else 'FAIL' end
  union all select 21, 'completed_at: DONE items still without a trusted source (see localStorage done_ts)', '0',
         (select count(*) from wi where scat = 'DONE' and completed_at is null)::text,
         case when (select count(*) from wi where scat = 'DONE' and completed_at is null) = 0 then 'PASS' else 'WARN' end
  union all select 22, 'reference data: 7 global statuses', '7',
         (select count(*) from statuses where project_id is null)::text,
         case when (select count(*) from statuses where project_id is null) = 7 then 'PASS' else 'FAIL' end
  union all select 23, 'reference data: people seeded from KNOWN_OWNERS, capacity_h not assumed', '4 people, 0 with capacity',
         (select count(*) from people)::text || ' people, ' || (select count(*) from people where capacity_h is not null)::text || ' with capacity',
         case when (select count(*) from people) >= 4 and (select count(*) from people where capacity_h is not null) = 0 then 'PASS' else 'FAIL' end
  union all select 24, 'relations/comments/activity/checklists: empty (schema only)', '0',
         ((select count(*) from work_item_relations) + (select count(*) from activity_events) + (select count(*) from checklist_items))::text,
         case when (select count(*) from work_item_relations) + (select count(*) from activity_events) + (select count(*) from checklist_items) = 0 then 'PASS' else 'WARN' end
  union all select 25, 'exceptions: BLOCKING rows awaiting review (excluded from migration)', '0',
         (select count(*) from migration_exceptions where severity = 'BLOCKING')::text,
         case when (select count(*) from migration_exceptions where severity = 'BLOCKING') = 0 then 'PASS' else 'WARN' end
  union all select 26, 'exceptions: WARN rows (migrated, review recommended)', '0',
         (select count(*) from migration_exceptions where severity = 'WARN')::text,
         case when (select count(*) from migration_exceptions where severity = 'WARN') = 0 then 'PASS' else 'WARN' end
)
select ord, chk as "check", expected, actual, result from checks
union all
select 99, 'OVERALL', '', '',
       case when exists (select 1 from checks where result = 'FAIL') then 'FAIL'
            when exists (select 1 from checks where result = 'WARN') then 'PASS (with WARN)' else 'PASS' end
order by 1;
