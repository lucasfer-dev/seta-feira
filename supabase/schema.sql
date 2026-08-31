-- SEXTA 1.3 — referência de schema.
-- O projeto desta conversa já recebeu as migrations via Supabase.
-- Para um projeto novo, prefira migrations versionadas e gere uma chave interna diferente.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists private.sexta_api_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null default 'sexta-core',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
revoke all on table private.sexta_api_keys from public, anon, authenticated;

create table if not exists public.sexta_vault_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'owner',
  path text not null,
  title text not null,
  markdown text not null default '',
  kind text not null default 'memory',
  tags jsonb not null default '[]'::jsonb,
  links jsonb not null default '[]'::jsonb,
  source_memory_id uuid null,
  content_hash text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, path)
);
alter table public.sexta_vault_notes enable row level security;

-- A instalação real também mantém RLS nas tabelas de mensagens, memórias,
-- dispositivos, comandos, eventos, notificações, push tokens e settings.
-- Segurança da Data API
-- A chave interna da SEXTA é validada dentro das próprias políticas RLS.
-- O valor bruto não fica nas policies: somente seu MD5 é embutido na função
-- SECURITY INVOKER. O schema private continua inacessível ao cliente.
-- Na instalação real, o hash deve ser calculado a partir da chave ativa em
-- private.sexta_api_keys.

-- Exemplo da função final (substitua <HASH_DA_CHAVE> no provisionamento):
create or replace function public.sexta_request_authorized()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select md5(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-sexta-api-key', '')) = '<HASH_DA_CHAVE>'
$$;

revoke all on function public.sexta_request_authorized() from public;
grant execute on function public.sexta_request_authorized() to anon, authenticated, service_role;

-- Em produção, cada tabela SEXTA recebe a policy abaixo (owner_id = 'owner'):
-- create policy sexta_server_all on public.<tabela>
-- for all to anon, authenticated
-- using (public.sexta_request_authorized() and owner_id = 'owner')
-- with check (public.sexta_request_authorized() and owner_id = 'owner');

-- Não usar pgrst.db_pre_request para esta validação. Isso evita problemas de
-- permissão/execução de funções privilegiadas no papel efetivo da requisição.
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
