import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {createHash} from 'node:crypto';
import {normalizeGift} from './market-source.js';
import {now} from './store.js';
const wanted=['listing','price','delisting'];
const amount=v=>/^[0-9]+$/.test(String(v))&&BigInt(v)>0n?String(v):null;
export function normalizeSeeEvent(m){
 if(m?.type!=='event'||m.market!=='telegram'||!wanted.includes(m.event))return null;
 const g=m.gift,d=g?.details||{},num=Number(g?.num??d.num),collection=g?.slug??d.slug;
 if(!/^[a-z0-9]+$/i.test(collection||'')||!Number.isSafeInteger(num)||num<1||!Number.isFinite(Date.parse(m.at)))return null;
 const slug=collection+'-'+num,at=new Date(m.at).toISOString();
 const id=createHash('sha256').update(JSON.stringify([m.event,m.market,slug,m.at,m.price||null])).digest('hex');
 if(m.event==='delisting')return{id,kind:m.event,slug,at};
 const prices=[],stars=amount(g.resellAmountStars??d.resellAmountStars),ton=amount(g.resellAmountTon??d.resellAmountTon);
 if(stars)prices.push({_: 'starsAmount',amount:stars,nanos:0});
 if(ton)prices.push({_: 'starsTonAmount',amount:ton});
 if(!prices.length){const a=amount(m.price?.amount);if(a&&m.price.currency==='xtr')prices.push({_: 'starsAmount',amount:a,nanos:0});else if(a&&['gram','ton'].includes(m.price.currency))prices.push({_: 'starsTonAmount',amount:a});}
 if(!prices.length||!String(g.id??d.id??'').match(/^\d+$/)||!g.title)return null;
 const lot=normalizeGift({_: 'starGiftUnique',id:String(d.id??g.id),giftId:d.giftId,slug,title:g.title,num,resellAmount:prices,resaleTonOnly:!!(g.resaleTonOnly??d.resaleTonOnly),attributes:[{_: 'starGiftAttributeModel',name:typeof g.model==='string'?g.model:d.model?.name}]},{});
 if(!lot)return null;
 // Guest data deliberately contains masked names; never promote them to contacts.
 return{id,kind:m.event,slug,at,lot:{...lot,source:'see-tg',externalId:id,observedAt:at,discoveredBy:'see.tg guest WebSocket'}};
}
export class SeeSource {
 constructor(s,env={}, {socketFactory=(url,o)=>new WebSocket(url,o),clock=now}={}){
  Object.assign(this,{s,env,socketFactory,clock});this.socket=null;this.closed=false;this.nextConnect=0;this.failures=0;this.disabled=new Set();
 }
 status(extra={}){const previous=this.s.one("SELECT value FROM meta WHERE key='see-feed'")?.value;let p={};try{p=JSON.parse(previous||'{}')}catch{}this.s.run("INSERT INTO meta VALUES('see-feed',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify({...p,...extra,mode:'guest',updatedAt:this.clock()}));}
 subscribe(){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({type:'subscribe',events:wanted.filter(k=>!this.disabled.has(k)),markets:['telegram']}));}
 receive(raw){
  let m;try{m=JSON.parse(String(raw))}catch{return;}
  if(m.type==='hello'){this.disabled=new Set(m.disabled||[]);this.status({connected:true,disabled:[...this.disabled]});this.subscribe();return;}
  if(m.type==='subscribed'){this.status({subscribed:m.events||[]});return;}
  if(m.type==='kind_disabled'||m.type==='kind_enabled'){
   for(const k of m.events||[])if(m.type==='kind_disabled')this.disabled.add(k);else this.disabled.delete(k);
   this.status({disabled:[...this.disabled]});this.subscribe();return;
  }
  if(m.type==='error'){this.status({error:m.code==='kind_disabled'?'Сервис отключил часть событий':'Ошибка подписки see.tg'});return;}
  const e=normalizeSeeEvent(m);if(!e)return;
  const time=Date.parse(e.at)/1000;if(time<this.clock()-180||time>this.clock()+120)return;
  this.s.run('INSERT OR IGNORE INTO see_events VALUES(?,?,?,?,?,0)',e.id,e.kind,e.slug,JSON.stringify(e),this.clock());
  this.status({lastEventAt:e.at,error:null});
 }
 connect(){
  if(this.closed||this.socket||this.clock()<this.nextConnect)return;
  const proxy=this.env.HTTPS_PROXY||this.env.HTTP_PROXY;
  try{
   const ws=this.socketFactory('wss://live.see.tg/v1/ws',{...(proxy?{agent:new HttpsProxyAgent(proxy)}:{}),handshakeTimeout:10000,maxPayload:1024*1024,perMessageDeflate:false});this.socket=ws;
   const heartbeat=()=>{clearTimeout(this.heartbeat);this.heartbeat=setTimeout(()=>ws.terminate(),40000);this.heartbeat.unref?.();};
   ws.on('open',()=>{this.failures=0;this.status({connected:true,error:null});heartbeat();this.subscribe();});ws.on('ping',heartbeat);
   ws.on('message',raw=>{try{this.receive(raw)}catch{this.status({error:'Событие see.tg не удалось сохранить'});ws.terminate();}});
   ws.on('error',()=>{this.status({error:'Соединение с see.tg недоступно'});});
   ws.on('close',code=>{clearTimeout(this.heartbeat);this.socket=null;this.nextConnect=this.clock()+Math.min(60,2**Math.min(++this.failures,6));if([4401,4403,4429].includes(code))this.nextConnect=Math.max(this.nextConnect,this.clock()+60);this.status({connected:false,lastCloseCode:code});});
  }catch{this.nextConnect=this.clock()+10;this.status({connected:false,error:'Не удалось открыть соединение see.tg'});}
 }
 async drain(app){
  for(const row of this.s.all('SELECT * FROM see_events WHERE done=0 ORDER BY received_at,rowid LIMIT 50')){
   await app.ingestSee(JSON.parse(row.data));this.s.run('UPDATE see_events SET done=1 WHERE id=?',row.id);
  }
  this.s.run('DELETE FROM see_events WHERE done=1 AND received_at<?',this.clock()-86400);
 }
 async close(){this.closed=true;clearTimeout(this.heartbeat);const ws=this.socket;if(!ws)return;await new Promise(resolve=>{const timeout=setTimeout(resolve,1000);timeout.unref?.();ws.once('close',()=>{clearTimeout(timeout);resolve()});ws.terminate()});this.socket=null;}
}
export async function runSeeFeed({source,app,shouldStop,isPaused}){
 while(!shouldStop()){
  source.connect();
  if(!isPaused())try{await source.drain(app)}catch{source.status({error:'Ошибка обработки сохранённого события see.tg'});}
  await new Promise(r=>setTimeout(r,250));
 }
}
