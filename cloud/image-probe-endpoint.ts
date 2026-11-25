// Public synthetic-only endpoint: never accesses storage, secrets or user data.
import { syntheticImage } from './image-probe.ts';
Deno.serve(async(req)=>{
 const h={'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Content-Type':'image/png'};
 if(req.method!=='GET')return new Response(null,{status:405,headers:{Allow:'GET'}});
 const u=new URL(req.url);
 if(u.searchParams.size!==1||!/^\d{13}$/.test(u.searchParams.get('expires')||''))return new Response('Invalid test URL',{status:400});
 const expiry=Number(u.searchParams.get('expires'));
 if(expiry<Date.now()||expiry>Date.now()+300000)return new Response('Test URL expired',{status:410});
 try {const data=await syntheticImage();return new Response(Uint8Array.from(atob(data),c=>c.charCodeAt(0)),{headers:h});}
 catch{return new Response('Image unavailable',{status:500});}
});
