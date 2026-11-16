-- OpsBoard: subtasks as real rows (children of a work item), plus the explode function.
--   * work_items.legacy_source accepts 'subtareas' (a subtask keeps the id the app uses as legacy_id).
--   * f1e_explode_subtasks(apply): moves work_items.legacy_subtareas (jsonb) into child rows (parent_id) and empties the
--     jsonb. Dry-run by default; idempotent (a subtask already present is skipped, nothing is duplicated).
--   * f1d_reverse (rollback only) now ignores child rows as items and rebuilds subtareas from them.
-- Additive: one constraint widened, functions replaced. No data is changed by this migration itself.

alter table work_items drop constraint if exists work_items_legacy_source_check;
alter table work_items add constraint work_items_legacy_source_check check (legacy_source in ('items', 'hitos', 'subtareas'));

create or replace function f1e_explode_subtasks(p_apply boolean default false)
returns table (parent_legacy_id text, subtask_id text, action text, note text)
language plpgsql as $$
#variable_conflict use_column
begin
  perform set_config('opsboard.sync', 'on', true);                 -- never fabricate completed_at
  drop table if exists _st;
  create temp table _st on commit drop as
  select w.id as parent_pm, w.legacy_id as parent_lid, w.project_id, w.created_at as parent_created, e.ord, e.val,
         nullif(btrim(e.val ->> 'id'), '') as sid,
         nullif(btrim(e.val ->> 'title'), '') as title,
         f1d_status_key(coalesce(nullif(e.val ->> 'status', ''), 'pending')) as status_key,
         case when e.val ->> 'risk' in ('green', 'yellow', 'red') then e.val ->> 'risk' end as risk,
         (select p.id from people p where nullif(btrim(e.val ->> 'prop'), '') is not null and opsboard_norm(p.name) = opsboard_norm(e.val ->> 'prop') limit 1) as assignee_id,
         nullif(btrim(e.val ->> 'prop'), '') as prop,
         case when (e.val ->> 'fechaFin') ~ '^\d{4}-\d{2}-\d{2}' then f1d_date((e.val ->> 'fechaFin')::timestamptz) end as due_date
  from work_items w
  cross join lateral jsonb_array_elements(w.legacy_subtareas) with ordinality as e(val, ord)
  where w.legacy_source = 'items' and jsonb_typeof(w.legacy_subtareas) = 'array';

  drop table if exists _stp;
  create temp table _stp on commit drop as
  select s.*,
         case when s.sid is null then 'no_id' when s.title is null then 'no_title' when s.status_key is null then 'bad_status'
              when exists (select 1 from work_items c where c.legacy_source = 'subtareas' and c.legacy_id = s.sid and c.parent_id = s.parent_pm) then 'exists'
              when exists (select 1 from work_items c where c.legacy_source = 'subtareas' and c.legacy_id = s.sid) then 'id_in_other_parent' end as problem
  from _st s;

  if p_apply then
    insert into work_items (legacy_source, legacy_id, type, parent_id, project_id, title, notes, status_id, assignee_id, due_date, risk, tags, created_at, legacy)
    select 'subtareas', s.sid, 'task', s.parent_pm, s.project_id, s.title, coalesce(s.val ->> 'notas', ''),
           (select st.id from statuses st where st.project_id is null and st.key = s.status_key), s.assignee_id, s.due_date, s.risk, '{}', s.parent_created, s.val
    from _stp s where s.problem is null order by s.parent_lid, s.ord
    on conflict (legacy_source, legacy_id) do nothing;
    -- parents whose subtasks are all present (inserted now or before) hand over to the child rows
    update work_items w set legacy_subtareas = '[]'::jsonb
     where w.id in (select parent_pm from _stp)
       and not exists (select 1 from _stp s where s.parent_pm = w.id and s.problem is not null and s.problem <> 'exists');
  end if;

  return query
    select s.parent_lid, s.sid,
           case when s.problem is null then 'insert' when s.problem = 'exists' then 'exists' else 'skip_invalid' end,
           case when s.problem is not null and s.problem <> 'exists' then s.problem
                when s.prop is not null and s.assignee_id is null then 'owner_unmatched: ' || s.prop end
    from _stp s order by s.parent_lid, s.ord;
end $$;
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
         (coalesce((select jsonb_agg(jsonb_build_object('id', coalesce(c.legacy_id, c.id::text), 'title', c.title, 'status', f1d_status_legacy(cs.key), 'prop', coalesce(cp.name, ''), 'risk', coalesce(c.risk, 'green'), 'notas', c.notes, 'fechaFin', case when c.due_date is null then null when c.legacy ? 'fechaFin' and (c.legacy->>'fechaFin') is not null and f1d_date((c.legacy->>'fechaFin')::timestamptz) = c.due_date then c.legacy->'fechaFin' else to_jsonb(f1d_ts(c.due_date)) end) order by c.number) from work_items c join statuses cs on cs.id = c.status_id left join people cp on cp.id = c.assignee_id where c.parent_id = w.id), w.legacy_subtareas)) as subtareas, w.legacy ->> 'estado_sheet' as estado_sheet_prev
  from work_items w join statuses s on s.id = w.status_id
  where w.type <> 'milestone' and w.parent_id is null;
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
    update work_items w set legacy_source = 'items', legacy_id = f1d_newid() where w.legacy_id is null and w.type <> 'milestone' and w.parent_id is null;
    insert into items (id, tema, objetivo, category, propietario, prioridad, risk, status, estado_sheet, fecha_inicio, fecha_fin, archivos, notas, proyecto, subtareas)
      select w.legacy_id, w.title, w.description, coalesce(w.tags[1], 'projects'), coalesce((select pe.name from people pe where pe.id = w.assignee_id), ''),
             f1d_prio_legacy(w.priority), coalesce(w.risk, 'green'), f1d_status_legacy(s.key), f1d_estado_sheet(f1d_status_legacy(s.key)),
             f1d_ts(w.start_date), f1d_ts(w.due_date), coalesce(w.legacy ->> 'archivos', ''), w.notes,
             coalesce((select pr.name from projects pr where pr.id = w.project_id), ''), (coalesce((select jsonb_agg(jsonb_build_object('id', coalesce(c.legacy_id, c.id::text), 'title', c.title, 'status', f1d_status_legacy(cs.key), 'prop', coalesce(cp.name, ''), 'risk', coalesce(c.risk, 'green'), 'notas', c.notes, 'fechaFin', case when c.due_date is null then null when c.legacy ? 'fechaFin' and (c.legacy->>'fechaFin') is not null and f1d_date((c.legacy->>'fechaFin')::timestamptz) = c.due_date then c.legacy->'fechaFin' else to_jsonb(f1d_ts(c.due_date)) end) order by c.number) from work_items c join statuses cs on cs.id = c.status_id left join people cp on cp.id = c.assignee_id where c.parent_id = w.id), w.legacy_subtareas))
      from work_items w join statuses s on s.id = w.status_id
      where w.type <> 'milestone' and w.parent_id is null and not exists (select 1 from items l where l.id = w.legacy_id);
    update items l set tema = r.tema, objetivo = r.objetivo, category = r.category, propietario = r.propietario, prioridad = r.prioridad, risk = r.risk,
           estado_sheet = case when l.status is distinct from r.status then f1d_estado_sheet(r.status) else l.estado_sheet end,
           status = r.status,
           fecha_inicio = case when f1d_date(l.fecha_inicio) is not distinct from f1d_date(r.fecha_inicio) then l.fecha_inicio else r.fecha_inicio end,
           fecha_fin = case when f1d_date(l.fecha_fin) is not distinct from f1d_date(r.fecha_fin) then l.fecha_fin else r.fecha_fin end,
           notas = r.notas, proyecto = r.proyecto, subtareas = r.subtareas
      from (select w.legacy_id, w.title as tema, w.description as objetivo, coalesce(w.tags[1], w.legacy ->> 'category', 'projects') as category,
                   coalesce((select pe.name from people pe where pe.id = w.assignee_id), '') as propietario, f1d_prio_legacy(w.priority) as prioridad,
                   coalesce(w.risk, 'green') as risk, f1d_status_legacy(s.key) as status, f1d_ts(w.start_date) as fecha_inicio, f1d_ts(w.due_date) as fecha_fin,
                   w.notes as notas, coalesce((select pr.name from projects pr where pr.id = w.project_id), '') as proyecto, (coalesce((select jsonb_agg(jsonb_build_object('id', coalesce(c.legacy_id, c.id::text), 'title', c.title, 'status', f1d_status_legacy(cs.key), 'prop', coalesce(cp.name, ''), 'risk', coalesce(c.risk, 'green'), 'notas', c.notes, 'fechaFin', case when c.due_date is null then null when c.legacy ? 'fechaFin' and (c.legacy->>'fechaFin') is not null and f1d_date((c.legacy->>'fechaFin')::timestamptz) = c.due_date then c.legacy->'fechaFin' else to_jsonb(f1d_ts(c.due_date)) end) order by c.number) from work_items c join statuses cs on cs.id = c.status_id left join people cp on cp.id = c.assignee_id where c.parent_id = w.id), w.legacy_subtareas)) as subtareas
            from work_items w join statuses s on s.id = w.status_id where w.type <> 'milestone' and w.parent_id is null) r
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


