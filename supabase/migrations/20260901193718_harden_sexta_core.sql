-- Canonical SEXTA schema. Safe to apply repeatedly to an existing project.
create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists private.sexta_api_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null default 'sexta-core',
  key_hash text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table private.sexta_api_keys add column if not exists key_hash text;
revoke all on table private.sexta_api_keys from public, anon, authenticated;

create or replace function private.sexta_request_authorized_from_keyring()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from private.sexta_api_keys
    where enabled
      and key_hash is not null
      and key_hash = encode(
        extensions.digest(
          coalesce(current_setting('request.headers', true)::jsonb ->> 'x-sexta-api-key', ''),
          'sha256'
        ),
        'hex'
      )
  )
$$;
revoke all on function private.sexta_request_authorized_from_keyring() from public;
grant usage on schema private to anon, authenticated, service_role;
grant execute on function private.sexta_request_authorized_from_keyring() to anon, authenticated, service_role;

-- Preserve the existing production validator when one is already installed.
do $$
begin
  if to_regprocedure('public.sexta_request_authorized()') is null then
    execute $function$
      create function public.sexta_request_authorized()
      returns boolean
      language sql
      stable
      security invoker
      set search_path = pg_catalog
      as 'select private.sexta_request_authorized_from_keyring()'
    $function$;
  end if;
end
$$;
revoke all on function public.sexta_request_authorized() from public;
grant execute on function public.sexta_request_authorized() to anon, authenticated, service_role;

create table if not exists public.sexta_messages (
  id uuid primary key default gen_random_uuid(), owner_id text not null default 'owner',
  conversation_id text not null default 'main', role text not null check (role in ('user', 'assistant', 'system')),
  content text not null, device_id text, created_at timestamptz not null default now()
);
create table if not exists public.sexta_memories (
  id uuid primary key default gen_random_uuid(), owner_id text not null default 'owner', content text not null,
  kind text not null default 'fact', importance numeric(4,3) not null default 0.650 check (importance between 0 and 1),
  source text not null default 'conversation', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.sexta_devices (
  device_id text primary key, owner_id text not null default 'owner', name text not null, kind text not null default 'browser',
  capabilities jsonb not null default '[]'::jsonb, context jsonb not null default '{}'::jsonb,
  last_seen timestamptz not null default now(), created_at timestamptz not null default now()
);
create table if not exists public.sexta_commands (
  id uuid primary key default gen_random_uuid(), owner_id text not null default 'owner', target_device_id text not null,
  action text not null, payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  result jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.sexta_events (
  id uuid primary key default gen_random_uuid(), owner_id text not null default 'owner', source_device_id text,
  level text not null default 'info', title text not null, body text not null default '',
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.sexta_notifications (
  id uuid primary key default gen_random_uuid(), owner_id text not null default 'owner', source text not null,
  source_id text, sender text not null default '', title text not null, body text not null default '',
  priority integer not null default 0 check (priority between 0 and 100), reason text not null default '',
  status text not null default 'unread' check (status in ('unread', 'read', 'dismissed', 'acted')),
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.sexta_push_tokens (
  id uuid primary key default gen_random_uuid(), owner_id text not null default 'owner', device_id text not null,
  provider text not null, token text not null, platform text not null default 'android', enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(provider, token)
);
create table if not exists public.sexta_settings (
  owner_id text primary key default 'owner', settings jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.sexta_integrations (
  id uuid primary key default gen_random_uuid(), owner_id text not null default 'owner', provider text not null,
  secret_payload text not null, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id, provider)
);
create table if not exists public.sexta_vault_notes (
  id uuid primary key default gen_random_uuid(), owner_id text not null default 'owner', path text not null, title text not null,
  markdown text not null default '', kind text not null default 'memory', tags jsonb not null default '[]'::jsonb,
  links jsonb not null default '[]'::jsonb, source_memory_id uuid references public.sexta_memories(id) on delete set null,
  content_hash text, version integer not null default 1, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(owner_id, path)
);
create table if not exists public.sexta_pending_actions (
  id uuid primary key default gen_random_uuid(), owner_id text not null default 'owner', tool_name text not null,
  args jsonb not null default '{}'::jsonb, context jsonb not null default '{}'::jsonb, summary text not null default '',
  status text not null default 'pending' check (status in ('pending', 'executing', 'completed', 'failed', 'canceled', 'expired')),
  result jsonb, expires_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists sexta_messages_conversation_created_idx on public.sexta_messages (conversation_id, created_at desc);
create index if not exists sexta_memories_priority_idx on public.sexta_memories (importance desc, updated_at desc);
create index if not exists sexta_devices_last_seen_idx on public.sexta_devices (last_seen desc);
create index if not exists sexta_commands_target_status_idx on public.sexta_commands (target_device_id, status, created_at);
create index if not exists sexta_events_created_idx on public.sexta_events (created_at desc);
create unique index if not exists sexta_notifications_source_unique on public.sexta_notifications (source, source_id) where source_id is not null;
create index if not exists sexta_notifications_created_idx on public.sexta_notifications (created_at desc);
create index if not exists sexta_pending_actions_owner_status_idx on public.sexta_pending_actions (owner_id, status, created_at desc);
create index if not exists sexta_pending_actions_expiry_idx on public.sexta_pending_actions (expires_at) where status = 'pending';

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'sexta_messages', 'sexta_memories', 'sexta_devices', 'sexta_commands', 'sexta_events',
    'sexta_notifications', 'sexta_push_tokens', 'sexta_settings', 'sexta_integrations',
    'sexta_vault_notes', 'sexta_pending_actions'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public', table_name);
    execute format('grant select, insert, update, delete on table public.%I to anon, authenticated, service_role', table_name);
    execute format('drop policy if exists sexta_server_all on public.%I', table_name);
    execute format(
      'create policy sexta_server_all on public.%I for all to anon, authenticated using (public.sexta_request_authorized() and owner_id = ''owner'') with check (public.sexta_request_authorized() and owner_id = ''owner'')',
      table_name
    );
  end loop;
end
$$;

alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload schema';
