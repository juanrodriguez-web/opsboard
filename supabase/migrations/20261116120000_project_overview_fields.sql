-- OpsBoard: Project Overview fields (Portfolio). Additive: three new columns on `projects`.
--   latest_update    text written by the project owner ("status update"), latest_update_at = when it was written
--   objectives       free text with the project's objectives
alter table projects add column if not exists latest_update    text not null default '';
alter table projects add column if not exists latest_update_at timestamptz;
alter table projects add column if not exists objectives       text not null default '';