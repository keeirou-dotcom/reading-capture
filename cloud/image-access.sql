begin;
create table reading_auth.image_client (
 owner_id uuid not null, client_id uuid not null,
 primary key(owner_id,client_id),
 foreign key(owner_id,client_id) references reading_auth.allowed_client(owner_id,client_id) on delete cascade
);
alter table reading_auth.image_client enable row level security;
revoke all on reading_auth.image_client from public,anon,authenticated;
create function reading_auth.image_allowed() returns boolean language sql stable security definer set search_path='' as $$
 select reading_auth.allowed() and exists(select 1 from reading_auth.image_client a where a.owner_id=auth.uid() and a.client_id::text=auth.jwt()->>'client_id')
$$;
revoke all on function reading_auth.image_allowed() from public,anon;
grant execute on function reading_auth.image_allowed() to authenticated;
create function public.reading_image_allowed() returns boolean language sql stable security invoker set search_path='' as $$ select reading_auth.image_allowed() $$;
revoke all on function public.reading_image_allowed() from public,anon;
grant execute on function public.reading_image_allowed() to authenticated;
create function reading_auth.image_resolve(record_id text, image_index integer) returns text language sql stable security definer set search_path='' as $$
 select e.image_hashes[image_index] from public.reading_entries e join reading_private.owner o on o.user_id=e.owner_id
 where reading_auth.image_allowed() and e.owner_id=auth.uid() and e.id=record_id
 and record_id ~ '^[0-9a-f]{64}$' and image_index between 1 and 10 and image_index<=cardinality(e.image_hashes)
 and e.image_hashes[image_index] ~ '^[0-9a-f]{64}$'
$$;
revoke all on function reading_auth.image_resolve(text,integer) from public,anon;
grant execute on function reading_auth.image_resolve(text,integer) to authenticated;
create function public.reading_image_resolve(record_id text,image_index integer) returns text language sql stable security invoker set search_path='' as $$ select reading_auth.image_resolve(record_id,image_index) $$;
revoke all on function public.reading_image_resolve(text,integer) from public,anon;
grant execute on function public.reading_image_resolve(text,integer) to authenticated;
commit;