-- Shared OAuth issuer. Enrollment is explicit and independent of other apps.
begin;
create schema reading_auth;
revoke all on schema reading_auth from public, anon, authenticated;
create table reading_auth.owner (singleton boolean primary key default true check(singleton),
  user_id uuid unique not null references auth.users(id));
create table reading_auth.allowed_client (owner_id uuid not null references reading_auth.owner(user_id),
  client_id uuid not null references auth.oauth_clients(id),primary key(owner_id,client_id));
alter table reading_auth.owner enable row level security;
alter table reading_auth.allowed_client enable row level security;
create function reading_auth.allowed() returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from reading_auth.allowed_client a
    join auth.sessions s on s.user_id=a.owner_id and s.oauth_client_id=a.client_id
    join auth.oauth_clients c on c.id=a.client_id and c.deleted_at is null
    join auth.oauth_consents g on g.client_id=a.client_id and g.user_id=a.owner_id and g.revoked_at is null
    where a.owner_id=auth.uid() and a.client_id::text=auth.jwt()->>'client_id'
    and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now())
  )
$$;
revoke all on function reading_auth.allowed() from public;
grant usage on schema reading_auth to authenticated;
grant execute on function reading_auth.allowed() to authenticated;
create function public.reading_mcp_allowed() returns boolean language sql stable security invoker set search_path=''
as $$ select reading_auth.allowed() $$;
revoke all on function public.reading_mcp_allowed() from public,anon;
grant execute on function public.reading_mcp_allowed() to authenticated;
commit;
