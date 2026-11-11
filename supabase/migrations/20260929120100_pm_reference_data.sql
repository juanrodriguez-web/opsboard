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
