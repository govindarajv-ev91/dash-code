-- Run in Supabase SQL Editor as the project owner after create_source_master.sql.
-- Adds optional Mail ID and phone number fields. Rerun if Mail ID was added earlier.
-- Safe to rerun. Existing sources, statuses and permissions are preserved.
begin;

alter table public.source_master
  add column if not exists email_id text not null default '',
  add column if not exists phone_number text not null default '';

notify pgrst, 'reload schema';
commit;
