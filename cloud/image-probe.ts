// Synthetic compatibility probe. No storage, network, or user data.
export async function syntheticImage():Promise<string>{
  const w=240,h=96;
  const raw=new Uint8Array(h*(1+w*3)).fill(255);
  for(let y=0;y<h;y++)raw[y*(1+w*3)]=0;
  const rect=(x:number,y:number,ww:number,hh:number,r:number,g:number,b:number)=>{
    for(let yy=y;yy<y+hh;yy++)for(let xx=x;xx<x+ww;xx++){
      const i=yy*(1+w*3)+1+xx*3;raw[i]=r;raw[i+1]=g;raw[i+2]=b;
    }
  };
  const masks=[63,6,91,79,102,109,125,7,127,111];
  const digits=crypto.getRandomValues(new Uint8Array(4));
  for(let j=0;j<4;j++){
    const x=18+j*55,y=8,m=masks[digits[j]%10];
    const seg=[[x+7,y,24,5],[x+31,y+5,5,19],[x+31,y+29,5,19],[x+7,y+48,24,5],[x+2,y+29,5,19],[x+2,y+5,5,19],[x+7,y+24,24,5]];
    seg.forEach(([a,b,c,d],i)=>{if(m&(1<<i))rect(a,b,c,d,20,25,35);});
  }
  const colors=[[220,45,45],[30,100,220],[20,150,70]];
  const order=crypto.getRandomValues(new Uint8Array(1))[0]%3;
  for(let i=0;i<3;i++){const [r,g,b]=colors[(i+order)%3];rect(30+i*75,72,30,18,r,g,b);}
  const u32=(n:number)=>new Uint8Array([n>>>24,n>>>16,n>>>8,n]);
  const chunk=(name:string,data:Uint8Array)=>{
    const tag=new TextEncoder().encode(name);
    let crc=0xffffffff;for(const bytes of [tag,data])for(const v of bytes){crc^=v;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    return [u32(data.length),tag,data,u32((crc^0xffffffff)>>>0)];
  };
  const ihdr=new Uint8Array(13);ihdr.set(u32(w));ihdr.set(u32(h),4);ihdr.set([8,2,0,0,0],8);
  const stream=new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  const compressed=new Uint8Array(await new Response(stream).arrayBuffer());
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),...chunk('IHDR',ihdr),...chunk('IDAT',compressed),...chunk('IEND',new Uint8Array())];
  const png=new Uint8Array(await new Blob(parts).arrayBuffer());
  if(png.length>65536)throw Error('Probe exceeds size limit');
  return btoa(String.fromCharCode(...png));
}
