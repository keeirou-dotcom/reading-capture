import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js';
import { z } from 'npm:zod@3.25.76';

const paging = {limit:z.number().int().min(1).max(50).default(20), offset:z.number().int().min(0).max(100000).default(0)};
const book = z.string().min(1).max(160);
export function registerReading(server:McpServer, authorization:string, reader:string) {
  const annotations = {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  const read = async (tool:string, args:Record<string,unknown>) => {
    try {
      const response = await fetch(reader,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{Authorization:authorization,'Content-Type':'application/json'}, body:JSON.stringify({tool,...args})});
      if (!response.ok) throw Error();
      return {content:[{type:'text' as const,text:JSON.stringify(await response.json())}]};
    } catch {
      return {isError:true,content:[{type:'text' as const,text:'読書記録を取得できません。本人認証・読書用の許可を確認してください。'}]};
    }
  };
  server.registerTool('get_books',{description:'同期済みの本を一覧表示',inputSchema:paging,annotations},args=>read('get_books',args));
  server.registerTool('get_book_details',{description:'書名・記録数・最終登録日時',inputSchema:{book_id:book},annotations},args=>read('get_book_details',args));
  server.registerTool('get_reading_progress',{description:'本人が最後に登録した既読ページ',inputSchema:{book_id:book},annotations},args=>read('get_reading_progress',args));
  server.registerTool('get_reading_sessions',{description:'読書記録と本人のメモ。登録時刻順',inputSchema:{book_id:book.optional(),...paging},annotations},args=>read('get_reading_sessions',args));
  server.registerTool('get_recent_captures',{description:'撮影セットの登録履歴と枚数。画像本体は含みません',inputSchema:{book_id:book.optional(),...paging},annotations},args=>read('get_recent_captures',args));
  server.registerTool('search_reading_notes',{description:'本人のメモを部分一致で検索',inputSchema:{term:z.string().trim().min(1).max(120),book_id:book.optional(),...paging},annotations},args=>read('search_reading_notes',args));
}

// Invoke before server.connect() on the existing issuer-side MCP endpoint.
// The reader URL is deployment configuration, never supplied by a tool caller.
export async function attachReading(server:McpServer, authorization:string, reader:string | undefined,
  check:()=>PromiseLike<{data:unknown}>) {
  if (!reader || !/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/reading-reader$/.test(reader)) return;
  try {
    if ((await check()).data === true) registerReading(server,authorization,reader);
  } catch { /* Reading outages must not interrupt existing tools. */ }
}
