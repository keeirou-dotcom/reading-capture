-- Apply once to the selected data project. New objects only; conflicts roll back.
begin;
create schema reading_private;
revoke all on schema reading_private from public, anon, authenticated;
create table reading_private.owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id)
);
alter table reading_private.owner enable row level security;
create function reading_private.is_writer() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.jwt()->>'client_id' is null and exists (
    select 1 from reading_private.owner o join auth.sessions s on s.user_id=o.user_id
    where o.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
    and s.oauth_client_id is null and (s.not_after is null or s.not_after>now())
  )
$$;
revoke all on function reading_private.is_writer() from public;
grant usage on schema reading_private to authenticated;
grant execute on function reading_private.is_writer() to authenticated;
create table public.reading_entries (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null default auth.uid() references auth.users(id),
  book_id text not null check (length(book_id) between 1 and 160),
  title text not null check (length(title) between 1 and 200),
  registered_at timestamptz not null default now(),
  last_page integer check(last_page between 1 and 99999),
  note text not null check(length(note)<=2000),
  capture_count integer not null check(capture_count between 0 and 10),
  image_hashes text[] not null check(cardinality(image_hashes) in (0,capture_count))
);
create index on public.reading_entries(owner_id, book_id, registered_at desc);
alter table public.reading_entries enable row level security;
revoke all on public.reading_entries from public, anon, authenticated;
grant insert(id,book_id,title,last_page,note,capture_count,image_hashes),select on public.reading_entries to authenticated;
create policy reading_writer_insert on public.reading_entries for insert to authenticated
with check(owner_id=auth.uid() and (select reading_private.is_writer()));
create policy reading_writer_select on public.reading_entries for select to authenticated
using(owner_id=auth.uid() and (select reading_private.is_writer()));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('reading-captures','reading-captures',false,8388608,array['image/jpeg']);
-- Restrictive guards also apply when unrelated buckets already have permissive policies.
create policy reading_guard_authenticated on storage.objects as restrictive to authenticated
using(bucket_id <> 'reading-captures' or (select reading_private.is_writer()))
with check(bucket_id <> 'reading-captures' or (select reading_private.is_writer()));
create policy reading_guard_anon on storage.objects as restrictive to anon
using(bucket_id <> 'reading-captures') with check(bucket_id <> 'reading-captures');
create policy reading_insert on storage.objects for insert to authenticated
with check(bucket_id='reading-captures' and name ~ '^[0-9a-f]{64}\.jpg$' and (select reading_private.is_writer()));
create policy reading_select on storage.objects for select to authenticated
using(bucket_id='reading-captures' and (select reading_private.is_writer()));
create function public.reading_lookup(tool text, book text default null, term text default null,
  max_rows integer default 20, row_offset integer default 0) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare records jsonb;
begin
  if max_rows is null or max_rows not between 1 and 50 or row_offset is null or row_offset not between 0 and 100000 then
    raise exception 'Invalid range'; end if;
  if tool in ('get_book_details','get_reading_progress') and nullif(book,'') is null then raise exception 'Book required'; end if;
  if tool='search_reading_notes' and (term is null or length(trim(term)) not between 1 and 120) then raise exception 'Search term required'; end if;
  if tool in ('get_books','get_book_details') then
    select jsonb_agg(to_jsonb(b) order by b.latest desc,b.book_id) into records from (
      select e.book_id,(array_agg(e.title order by e.registered_at desc,e.id desc))[1] as title,
        count(*) as sessions,max(e.registered_at) as latest
      from public.reading_entries e join reading_private.owner o on e.owner_id=o.user_id
      where book is null or e.book_id=book group by e.book_id order by latest desc,e.book_id limit max_rows offset row_offset
    ) b;
  elsif tool in ('get_reading_sessions','get_recent_captures','search_reading_notes','get_reading_progress') then
    select jsonb_agg(to_jsonb(s) order by s.registered_at desc,s.id desc) into records from (
      select e.id,e.book_id,e.title,e.registered_at,e.last_page,
        case when tool in ('get_reading_sessions','search_reading_notes') then e.note end as note,
        e.capture_count,cardinality(e.image_hashes) as stored_images
      from public.reading_entries e join reading_private.owner o on e.owner_id=o.user_id
      where (book is null or e.book_id=book)
        and (tool<>'get_recent_captures' or e.capture_count>0)
        and (tool<>'search_reading_notes' or strpos(lower(e.note),lower(trim(term)))>0)
        and (tool<>'get_reading_progress' or e.last_page is not null)
      order by e.registered_at desc,e.id desc limit case when tool='get_reading_progress' then 1 else max_rows end offset row_offset
    ) s;
  else raise exception 'Unknown tool'; end if;
  return coalesce(records,'[]'::jsonb);
end $$;
grant usage on schema reading_private to service_role;
grant select on reading_private.owner,public.reading_entries to service_role;
revoke all on function public.reading_lookup(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.reading_lookup(text,text,text,integer,integer) to service_role;
commit;
