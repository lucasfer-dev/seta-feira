-- SEXTA 2.0 incremental schema.
-- Apply only after validating the refactor branch against staging.

create table if not exists public.sexta_missions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'owner',
  goal text not null,
  status text not null default 'queued'
    check (status in ('queued','waiting_for_device','running','completed','failed','cancelled')),
  source_device_id text null,
  assigned_device_id text null,
  required_capability text null,
  context jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  result jsonb null,
  error jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sexta_missions_owner_status_idx
  on public.sexta_missions(owner_id, status, updated_at desc);

alter table public.sexta_missions enable row level security;

-- Production policy follows the existing SEXTA Data API authorization contract.
-- Execute only after public.sexta_request_authorized() exists.
drop policy if exists sexta_server_all on public.sexta_missions;
create policy sexta_server_all on public.sexta_missions
for all to anon, authenticated
using (public.sexta_request_authorized() and owner_id = 'owner')
with check (public.sexta_request_authorized() and owner_id = 'owner');
