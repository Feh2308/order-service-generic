-- Generic Service Manager - Supabase/PostgreSQL storage table
-- Run this in the Supabase SQL Editor before applying the migration.
-- This table matches the backend's current DB_CLIENT=postgres storage format.

create table if not exists public.service_manager_store (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.service_manager_store is
  'Persistent JSONB store used by the generic service management backend.';

comment on column public.service_manager_store.id is
  'Storage key. The backend currently uses default.';

comment on column public.service_manager_store.data is
  'Full normalized application database copied from the JSON backup.';

create index if not exists service_manager_store_updated_at_idx
  on public.service_manager_store (updated_at desc);

-- The backend accesses this table through the private PostgreSQL connection
-- string, not through Supabase public REST APIs. Keep browser clients pointed
-- at the Railway backend, never directly at this table.
alter table public.service_manager_store enable row level security;

revoke all on table public.service_manager_store from anon;
revoke all on table public.service_manager_store from authenticated;
