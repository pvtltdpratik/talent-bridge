-- Standalone (non-Supabase) Postgres bootstrap, e.g. Amazon RDS.
-- Provides the small slice of Supabase that the migrations and the local auth provider rely on:
--   * roles anon / authenticated / service_role (referenced by RLS policies)
--   * schema "auth" with auth.users (identity + password hash), refresh and recovery tokens
--   * auth.uid() used by the read-only RLS policies
-- Idempotent: safe to run on every deploy. Do NOT run this on a Supabase project (it already has all of it).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  encrypted_password text,
  created_at         timestamptz not null default now()
);
create unique index if not exists auth_users_email_uq on auth.users (lower(email));

-- refresh tokens are stored hashed and rotated on use
create table if not exists auth.refresh_tokens (
  token_hash text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_refresh_user_idx on auth.refresh_tokens (user_id);

-- single-use password recovery tokens, stored hashed
create table if not exists auth.recovery_tokens (
  token_hash text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_recovery_user_idx on auth.recovery_tokens (user_id);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public, auth to anon, authenticated;
-- the identity tables are never readable by the browser-facing roles
revoke all on auth.users, auth.refresh_tokens, auth.recovery_tokens from anon, authenticated;
