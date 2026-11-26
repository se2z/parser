import Long from 'long';
import {createHash} from 'node:crypto';
import {marketClient} from './market-client.js';
import {enrichGiftOwner} from './gift-owner.js';
import {ownerFromPublicProfile} from './owner-profile.js';

const saleAmount=g=>(!g.resaleTonOnly&&g.resellAmount?.find(a=>a._==='starsAmount'))||g.resellAmount?.find(a=>a._==='starsTonAmount');
const signature=g=>{const a=saleAmount(g);return 'v2:'+createHash('sha256').update(JSON.stringify([
  g.slug,g.ownerId?.userId?.toString()||g.ownerId?.channelId?.toString()||g.ownerAddress||'',
  a?[a._,a.amount.toString(),a.nanos||0]:null,
])).digest('hex')};
export function sameSale(previous,current){
  if(!current||previous.slug!==current.slug||previous.currency!==current.currency)return false;
  if(String(previous.priceText??previous.price)!==String(current.priceText??current.price))return false;
  // A more detailed response may reveal an owner omitted from the catalogue.
  if(previous.ownerId&&current.ownerId&&previous.ownerId!==current.ownerId)return false;
  if(previous.ownerAddress&&current.ownerAddress&&previous.ownerAddress!==current.ownerAddress)return false;
  return true;
}
const floodSeconds=e=>Number(e.seconds)||Number(String(e.text||e.errorMessage||e.message||'').match(/FLOOD_(?:PREMIUM_)?WAIT_?(\d+)/)?.[1])||0;

export function normalizeGift(g,result) {
  if(g._!=='starGiftUnique'||!g.slug||!g.resellAmount?.length)return null;
  // Prefer the actual Stars price when both currencies are available, never invent an exchange rate.
  const amount=saleAmount(g);
  if(!amount)return null;
  const isTon=amount._==='starsTonAmount';
  const units=BigInt(amount.amount.toString())*(isTon?1n:1000000000n)+(isTon?0n:BigInt(amount.nanos||0));
  if(units<0n)return null;
  const fraction=(units%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');
  const priceText=(units/1000000000n).toString()+(fraction?'.'+fraction:'');
  const price=Number(priceText);
  const alternativeTon=g.resellAmount.find(a=>a._==='starsTonAmount');
  let tonPriceText;
  if(alternativeTon){const n=BigInt(alternativeTon.amount.toString()),f=(n%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');tonPriceText=(n/1000000000n).toString()+(f?'.'+f:'');}
  const peer=g.ownerId;
  const owner=peer? (peer._==='peerUser'
    ?result.users?.find(u=>u.id.toString()===peer.userId.toString())
    :result.chats?.find(c=>c.id.toString()===(peer.channelId||peer.chatId).toString())):null;
  const username=owner?.username||owner?.usernames?.find(u=>u.active)?.username;
  return {
    source:'telegram-market',externalId:g.slug+':'+signature(g),
    slug:g.slug,giftId:g.id.toString(),collectionId:g.giftId?.toString(),
    name:g.title,number:g.num,model:g.attributes?.find(a=>a._==='starGiftAttributeModel')?.name,
    price,priceText,currency:isTon?'TON':'XTR',
    ...(tonPriceText?{ton:Number(tonPriceText),tonPriceText,tonKind:'listed'}:{}),giftUrl:`https://t.me/nft/${encodeURIComponent(g.slug)}`,
    ...(username?{ownerUsername:username}:{}),
    ...(owner?._==='user'?{premium:!!owner.premium}:{}),
    ownerId:peer?.userId?.toString()||peer?.channelId?.toString(),
    ownerName:g.ownerName,ownerAddress:g.ownerAddress,observedAt:new Date().toISOString(),
  };
}

export class TelegramMarketSource {
  constructor(store,client,options={}) {
    this.s=store;this.client=client;this.options=options;this.index=0;
    this.ids=options.giftIds||[];this.refreshAt=0;this.blockedUntil=0;
    this.s.db.exec(`CREATE TABLE IF NOT EXISTS market_seen(slug TEXT PRIMARY KEY,signature TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS market_baseline(collection_id TEXT PRIMARY KEY);`);
  }
  async request(data) {
    const delay=this.options.requestDelayMs||0;
    for(let attempt=0;attempt<2;attempt++){
      const remaining=(this.nextRequestAt||0)-Date.now();
      if(remaining>0)await new Promise(r=>setTimeout(r,remaining));
      this.nextRequestAt=Date.now()+delay;
      try{return await this.client.call(data,{floodSleepThreshold:0,maxRetryCount:0,timeout:20000});}
      catch(e){const message=String(e.text||e.errorMessage||e.message||e.name||'');const transient=/TIMEOUT|timed? ?out|RPC_MCGET_FAIL|ECONN|network|connection/i.test(message);const flood=Number(e.seconds)||Number(message.match(/FLOOD_(?:PREMIUM_)?WAIT_?(\d+)/)?.[1]);if(attempt||!transient||flood){const wrapped=Error(`MTProto ${data._}: ${message}`);wrapped.seconds=flood;throw wrapped;}}
    }
    throw Error('Маркет: запрос не выполнен после повтора');
  }
  beginSweep() {
    // The catalogue is cached; refreshing 124 collections does not require reloading it each sweep.
  }
  async poll() {
    if(Date.now()<this.blockedUntil)return [];
    try {return await this.scan();}
    catch(e) {
      const text=String(e.text||e.errorMessage||e.message||'');
      const seconds=e.seconds||Number(text.match(/FLOOD_(?:PREMIUM_)?WAIT_?(\d+)/)?.[1]);
      this.blockedUntil=Date.now()+Math.max(1,Number(seconds)||10)*1000;
      // Do not log the session, phone, full RPC request or credentials.
      const detail=e.message||e.text||e.errorMessage||e.name||'RPC error';
      throw Error(seconds?`Маркет: FLOOD_WAIT, пауза ${seconds} сек`:'Маркет: запрос не выполнен ('+detail+')');
    }
  }
  async scan() {
    if(!this.options.giftIds?.length&&(Date.now()>this.refreshAt||!this.ids.length)) {
      const catalog=await this.request({_: 'payments.getStarGifts',hash:0});
      this.ids=(catalog.gifts||[]).filter(g=>g._==='starGift'&&BigInt(g.availabilityResale?.toString()||'0')>0n).map(g=>g.id.toString());
      this.refreshAt=Date.now()+3600000;
      if(!this.ids.length)return [];
    }
    const id=this.ids[this.index%this.ids.length];
    const baseline=!!this.s.one('SELECT 1 FROM market_baseline WHERE collection_id=?',id);
    const output=[],observed=[];let offset='',truncated=false;
    for(let page=0;page<(this.options.maxPages||3);page++) {
      const result=await this.request({_: 'payments.getResaleStarGifts',giftId:Long.fromString(id),offset,limit:this.options.pageSize||100});
      this.ownerIndex?.discover(result,{source:'telegram-market',reference:id});
      let overlap=false;
      for(const g of result.gifts||[]) {
        const d=normalizeGift(g,result);if(!d)continue;
        const sig=signature(g),previous=this.s.one('SELECT signature FROM market_seen WHERE slug=?',g.slug);
        const legacy=previous&&!previous.signature.startsWith('v2:');
        if(previous?.signature===sig||legacy)overlap=true;
        observed.push([g.slug,sig]);
        if((baseline||this.options.publishExisting)&&!legacy&&(!previous||previous.signature!==sig))output.push(d);
      }
      offset=result.nextOffset||'';
      if(!offset||overlap)break;
      if(page+1===(this.options.maxPages||3))truncated=true;
    }
    // Main loop calls commit only after ingest committed publications. Failed ingestion loses no events.
    this.pending={id,observed};
    if(truncated&&baseline)console.warn(`Маркет: достигнут лимит страниц коллекции ${id}; возможны пропуски. Увеличьте MARKET_MAX_PAGES или сократите список коллекций.`);
    return output;
  }
  commit() {
    if(!this.pending)return;
    const {id,observed}=this.pending;
    this.s.tx(()=>{for(const [slug,sig] of observed)this.s.run('INSERT INTO market_seen VALUES(?,?) ON CONFLICT(slug) DO UPDATE SET signature=excluded.signature',slug,sig);this.s.run('INSERT OR IGNORE INTO market_baseline VALUES(?)',id)});
    this.pending=null;this.index++;
  }
  async close(){await this.client.destroy()}
  async verify(lot) {
    this.verifiedGift=null;this.latestGift=null;
    if(Date.now()<(this.verifyBlockedUntil||0))throw Error(`Проверка лота ограничена Telegram. Повторите через ${Math.ceil((this.verifyBlockedUntil-Date.now())/1000)} сек.`);
    let result;try{result=await this.request({_: 'payments.getUniqueStarGift',slug:lot.slug})}catch(e){const seconds=floodSeconds(e);if(seconds){this.verifyBlockedUntil=Date.now()+seconds*1000;throw Error(`Проверка лота ограничена Telegram. Повторите через ${seconds} сек.`)}throw e;}
    const current=result.gift&&normalizeGift(result.gift,result);
    this.ownerIndex?.discover(result,{source:'gift-details',reference:lot.slug});
    this.latestGift=current||null;
    const valid=sameSale(lot,current);
    if(valid){
      let enriched=await enrichGiftOwner(current,{fetchPage:this.options.fetchPage});
      if(this.ownerIndex)try{enriched=await this.ownerIndex.confirm(enriched,r=>this.request(r));}catch(e){this.ownerBlockedUntil=Date.now()+Math.max(10,floodSeconds(e))*1000;}
      if(Date.now()>=(this.ownerBlockedUntil||0)&&!this.ownerIndex?.blocked())try{enriched=await ownerFromPublicProfile(enriched,r=>this.request(r));}catch(e){this.ownerBlockedUntil=Date.now()+Math.max(10,floodSeconds(e))*1000;}
      this.verifiedGift={...enriched,externalId:lot.externalId};
    }
    return valid;
  }
}

export async function createMarketSource(store,env) {
  const client=await marketClient(env);
  try {
    const self=await client.getMe();
    if(self.isBot)throw Error('Сессия принадлежит боту');
  } catch {await client.destroy();throw Error('Нет рабочей пользовательской сессии. Выполните login-market.bat локально.');}
  return new TelegramMarketSource(store,client,marketOptions(env));
}
export function marketOptions(env) {
  const ids=(env.MARKET_GIFT_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(ids.some(id=>!/^\d+$/.test(id)))throw Error('MARKET_GIFT_IDS: нужны числовые ID через запятую');
  const integer=(key,fallback,max)=>{const n=Number(env[key]||fallback);if(!Number.isInteger(n)||n<1||n>max)throw Error('Некорректная настройка '+key);return n};
  return {
    giftIds:ids,maxPages:integer('MARKET_MAX_PAGES',3,100),pageSize:integer('MARKET_PAGE_SIZE',100,100),
    requestDelayMs:integer('MARKET_REQUEST_DELAY_MS',1000,60000),publishExisting:env.MARKET_PUBLISH_EXISTING==='true',
  };
}
