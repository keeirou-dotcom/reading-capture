-- B: reader and issuer share one database. Do not send a bearer token to another service.
begin;
create function reading_auth.lookup(tool text, book text, term text, max_rows integer, row_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not reading_auth.allowed() then raise insufficient_privilege; end if;
  return public.reading_lookup(tool,book,term,max_rows,row_offset);
end $$;
revoke all on function reading_auth.lookup(text,text,text,integer,integer) from public,anon;
grant execute on function reading_auth.lookup(text,text,text,integer,integer) to authenticated;
create function public.reading_mcp_lookup(tool text, book text, term text, max_rows integer, row_offset integer)
returns jsonb language sql stable security invoker set search_path='' as $$
  select reading_auth.lookup(tool,book,term,max_rows,row_offset)
$$;
revoke all on function public.reading_mcp_lookup(text,text,text,integer,integer) from public,anon;
grant execute on function public.reading_mcp_lookup(text,text,text,integer,integer) to authenticated;
commit;
