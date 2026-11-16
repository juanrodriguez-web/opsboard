-- OpsBoard H: Backlog Mail. EJECUTAR EN EL SQL EDITOR DEL PROYECTO OpsBoard (qmgmvtjnbarqonrfmpix). Solo crea una tabla nueva.

-- OpsBoard: "Backlog Mail". Staging area for work proposed from e-mails (topics or projects) that the user decides on:
-- Create (becomes a pending topic / a project) or Ignore. Additive: one new table; nothing existing is touched.
-- PRIVACY: store only subject, sender, a short summary and a link to the message. Never the body or attachments
-- (the tables have an open policy until Auth exists).
-- message_id is UNIQUE: the same e-mail is never proposed twice, so "Ignore" is permanent.
create table if not exists mail_candidates (
  id                 uuid primary key default gen_random_uuid(),
  message_id         text not null unique check (btrim(message_id) <> ''),
  thread_id          text,
  subject            text not null default '',
  sender_name        text not null default '',
  sender_email       text not null default '',
  received_at        timestamptz,
  summary            text not null default '',
  suggested_title    text not null check (btrim(suggested_title) <> ''),
  kind               text not null default 'topic' check (kind in ('topic', 'project')),
  suggested_project  text not null default '',
  suggested_priority text not null default '' check (suggested_priority in ('', 'P0', 'P1', 'P2', 'P3')),
  due_date           date,
  priority_sender    boolean not null default false,      -- from a sender the user asked to prioritise
  duplicate_of       text not null default '',            -- title of a similar existing topic, if any
  web_link           text not null default '',
  status             text not null default 'pending' check (status in ('pending', 'created', 'ignored')),
  created_ref        text,                                -- legacy_id of the topic / project created from it
  decided_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists mail_candidates_status_idx on mail_candidates (status, received_at desc);

alter table mail_candidates enable row level security;
drop policy if exists public_all on mail_candidates;
create policy public_all on mail_candidates for all using (true) with check (true);
