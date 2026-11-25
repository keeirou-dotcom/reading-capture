import { syntheticImage } from './image-probe.ts';
import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js';
import { z } from 'npm:zod@3.25.76';

const paging = {limit:z.number().int().min(1).max(50).default(20), offset:z.number().int().min(0).max(100000).default(0)};
const book = z.string().min(1).max(160);
type ReadingClient = {
  rpc(name:string, args?:Record<string,unknown>):PromiseLike<{data:unknown,error:unknown}>;
};
export async function attachReading(server:McpServer, db:ReadingClient) {
  const {data:allowed} = await db.rpc('reading_mcp_allowed');
  if (allowed !== true) return;
  const annotations = {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  const read = async (tool:string, args:Record<string,unknown>) => {
    const {data,error} = await db.rpc('reading_mcp_lookup', {
      tool, book:args.book_id ?? null, term:args.term ?? null,
      max_rows:args.limit ?? 20, row_offset:args.offset ?? 0
    });
    if (error) return {isError:true,content:[{type:'text' as const,text:'読書記録を取得できません。読書用の許可を確認してください。'}]};
    return {content:[{type:'text' as const,text:JSON.stringify(data)}]};
  };
  server.registerTool('get_books',{description:'同期済みの本を一覧表示',inputSchema:paging,annotations},args=>read('get_books',args));
  server.registerTool('get_book_details',{description:'書名・記録数・最終登録日時',inputSchema:{book_id:book},annotations},args=>read('get_book_details',args));
  server.registerTool('get_reading_progress',{description:'本人が最後に登録した既読ページ',inputSchema:{book_id:book},annotations},args=>read('get_reading_progress',args));
  server.registerTool('get_reading_sessions',{description:'読書記録と本人のメモ。登録時刻順',inputSchema:{book_id:book.optional(),...paging},annotations},args=>read('get_reading_sessions',args));
  server.registerTool('get_recent_captures',{description:'撮影セットの登録履歴と枚数。画像本体は含みません',inputSchema:{book_id:book.optional(),...paging},annotations},args=>read('get_recent_captures',args));
  server.registerTool('search_reading_notes',{description:'本人のメモを部分一致で検索',inputSchema:{term:z.string().trim().min(1).max(120),book_id:book.optional(),...paging},annotations},args=>read('search_reading_notes',args));
  server.registerTool('test_reading_image',{description:'画像認識の互換性試験。個人データを含まない合成PNG画像のみを返す。数字と色は画像内だけに含まれる。',annotations:{...annotations,idempotentHint:false}},async()=>{
    const {data:permitted,error}=await db.rpc('reading_mcp_allowed');
    if(error||permitted!==true)return {isError:true,content:[{type:'text' as const,text:'読書用の許可がありません。'}]};
    try{return {content:[{type:'image' as const,data:await syntheticImage(),mimeType:'image/png'}]};}
    catch{return {isError:true,content:[{type:'text' as const,text:'テスト画像を生成できませんでした。'}]};}
  });
}
