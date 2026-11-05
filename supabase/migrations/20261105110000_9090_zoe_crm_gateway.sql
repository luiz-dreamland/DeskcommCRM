-- manifest: Configuração do gateway n8n da Zoe por organização. O cabeçalho de autorização fica cifrado e só o servidor pode ler a tabela.
-- A Zoe é acionada somente pelo operador autenticado; não envia mensagens nem grava dados do CRM.

create table if not exists public.organization_zoe_gateway_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  webhook_url text not null,
  company_slug text not null,
  authorization_header_encrypted bytea not null,
  last_successful_call_at timestamptz,
  last_error_code text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_zoe_gateway_company_check
    check (company_slug in ('dreamland', 'fonte-solar')),
  constraint organization_zoe_gateway_error_code_check
    check (last_error_code is null or last_error_code in ('network_error', 'timeout', 'upstream_error', 'invalid_response', 'credential_unavailable'))
);

comment on table public.organization_zoe_gateway_connections is
  'Conexão do operador com o gateway Zoe no n8n. Cabeçalho cifrado; sem acesso direto pelo PostgREST.';
comment on column public.organization_zoe_gateway_connections.authorization_header_encrypted is
  'Cabeçalho Authorization cifrado via fn_encrypt_oauth; nunca é retornado à interface.';

alter table public.organization_zoe_gateway_connections enable row level security;
revoke all on public.organization_zoe_gateway_connections from public, anon, authenticated;
grant select, insert, update, delete on public.organization_zoe_gateway_connections to service_role;

notify pgrst, 'reload schema';
