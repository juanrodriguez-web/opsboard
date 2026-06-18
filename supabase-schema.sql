-- ================================================================
-- OpsBoard — Supabase Schema
-- Run this once in Supabase SQL Editor
-- ================================================================

-- ITEMS (Temas / Tareas)
create table if not exists items (
  id            text primary key,
  tema          text not null,
  objetivo      text default '',
  category      text default 'projects',
  propietario   text default '',
  prioridad     text default '',
  risk          text default 'green',
  status        text default 'pending',
  estado_sheet  text default 'No iniciado',
  fecha_inicio  timestamptz,
  fecha_fin     timestamptz,
  archivos      text default '',
  notas         text default '',
  proyecto      text default '',
  subtareas     jsonb default '[]',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- PROYECTOS
create table if not exists proyectos (
  id            text primary key,
  nombre        text not null,
  descripcion   text default '',
  propietario   text default '',
  prioridad     text default '',
  estado        text default '',
  status        text default 'pending',
  desarrollo    text default '',
  fecha_inicio  timestamptz,
  fecha_fin     timestamptz,
  notas         text default '',
  fase          text default '',
  capex         numeric,
  nombre_en     text default '',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Run these if the proyectos table already exists (ALTER to add missing columns):
-- alter table proyectos add column if not exists status text default 'pending';
-- alter table proyectos add column if not exists fase text default '';
-- alter table proyectos add column if not exists capex numeric;
-- alter table proyectos add column if not exists nombre_en text default '';

-- COMENTARIOS (para items y proyectos)
create table if not exists comentarios (
  id            text primary key,
  item_id       text references items(id) on delete cascade,
  proyecto_id   text references proyectos(id) on delete cascade,
  texto         text not null,
  ts            text,
  created_at    timestamptz default now()
);

-- HITOS (milestones/fases de proyectos)
create table if not exists hitos (
  id            text primary key,
  proyecto_id   text not null references proyectos(id) on delete cascade,
  nombre        text not null,
  descripcion   text default '',
  fecha_prevista timestamptz,
  completado    boolean default false,
  orden         integer,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists idx_hitos_proyecto on hitos(proyecto_id);

-- CAMPANAS (si se usan)
create table if not exists campanas (
  id            text primary key,
  nombre        text not null,
  estado        text default '',
  fecha_inicio  timestamptz,
  fecha_fin     timestamptz,
  notas         text default '',
  created_at    timestamptz default now()
);

-- ── RLS (Row Level Security) ──────────────────────────────────────
-- App pública: todos pueden leer y escribir (protegida por la URL del proyecto)
alter table items      enable row level security;
alter table proyectos  enable row level security;
alter table comentarios enable row level security;
alter table campanas   enable row level security;
alter table hitos      enable row level security;

create policy "public_all" on items      for all using (true) with check (true);
create policy "public_all" on proyectos  for all using (true) with check (true);
create policy "public_all" on comentarios for all using (true) with check (true);
create policy "public_all" on campanas   for all using (true) with check (true);
create policy "public_all" on hitos      for all using (true) with check (true);

-- ── Auto-updated_at ───────────────────────────────────────────────
create or replace function _set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger items_updated_at     before update on items     for each row execute function _set_updated_at();
create trigger proyectos_updated_at before update on proyectos for each row execute function _set_updated_at();
