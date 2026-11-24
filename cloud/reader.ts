// Deploy as reading-reader with gateway verify_jwt=false when using a separate issuer.
// The fixed issuer verifies the caller token and live session on every request.
const json = (body:unknown,status:number) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
Deno.serve(async request => {
  if (request.method !== 'POST') return json({error:'Method not allowed'},405);
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer [^\s]+$/.test(authorization)) return json({error:'Authentication required'},401);
  try {
    const rpc = async (url:string, key:string, auth:string, name:string, args:unknown) =>
      fetch(url+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),
        headers:{Authorization:auth,apikey:key,'Content-Type':'application/json'},body:JSON.stringify(args)});
    const check = await rpc(Deno.env.get('READING_ISSUER_URL')!,Deno.env.get('READING_ISSUER_PUBLIC_KEY')!,
      authorization,'reading_mcp_allowed',{});
    if (!check.ok || await check.json() !== true) return json({error:'Access denied'},403);
    const body = await request.json();
    const allowed = ['get_books','get_book_details','get_reading_progress','get_reading_sessions','get_recent_captures','search_reading_notes'];
    if (!allowed.includes(body?.tool)) return json({error:'Unknown tool'},400);
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const result = await rpc(Deno.env.get('SUPABASE_URL')!,key,'Bearer '+key,'reading_lookup',{
      tool:body.tool,book:body.book_id??null,term:body.term??null,max_rows:body.limit??20,row_offset:body.offset??0});
    if (!result.ok) return json({error:'Read failed'},400);
    return json(await result.json(),200);
  } catch {return json({error:'Reader unavailable'},503);}
});
