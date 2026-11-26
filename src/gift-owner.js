// Use only the Owner cell of the original gift page, never names found elsewhere.
const decode=s=>s.replace(/&(?:amp|quot|apos|lt|gt|#39|#(\d+)|#x([\da-f]+));/gi,(m,n,h)=>n||h?String.fromCodePoint(parseInt(n||h,h?16:10)):({'&amp;':'&','&quot;':'"','&apos;':"'",'&#39;':"'",'&lt;':'<','&gt;':'>'}[m.toLowerCase()]||m));
export function publicOwnerUsername(html){
  const cell=html.match(/<th\b[^>]*>\s*Owner\s*<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1];
  if(!cell)return null;
  const href=cell.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  if(!href)return null;
  try{const u=new URL(decode(href));
    if(u.protocol!=='https:'||u.hostname!=='t.me'||u.port||u.username||u.password||u.search||u.hash)return null;
    const name=u.pathname.match(/^\/([a-z][a-z0-9_]{3,31})\/?$/i)?.[1];
    return name&&!['nft','share','login','proxy','socks','joinchat','addstickers','addemoji','contact','giftcode','boost','invoice','addlist','iv'].includes(name.toLowerCase())?name:null;
  }catch{return null;}
}
export async function enrichGiftOwner(lot,{fetchPage=globalThis.fetch}={}){
  if(lot.ownerUsername||!lot.slug||!/^[a-z0-9]+-\d+$/i.test(lot.slug)||lot.ownerAddress)return lot;
  // A web failure must not prevent a valid internal reservation.
  try{
    const r=await fetchPage(`https://t.me/nft/${lot.slug}`,{redirect:'error',signal:AbortSignal.timeout(3000),headers:{'Accept-Language':'en','Accept':'text/html'}});
    if(!r.ok||!r.headers.get('content-type')?.includes('text/html'))return lot;
    let html='';
    const reader=r.body.getReader(),decoder=new TextDecoder();
    try{while(true){const {done,value}=await reader.read();if(done)break;html+=decoder.decode(value,{stream:true});if(html.length>262144)return lot;}}finally{await reader.cancel();}
    const username=publicOwnerUsername(html);
    return username?{...lot,ownerUsername:username,ownerUsernameSource:'telegram-public-gift-page'}:lot;
  }catch{return lot;}
}
