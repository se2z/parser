import {createHash} from 'node:crypto';
import {now} from './store.js';
import {enrichGiftOwner} from './gift-owner.js';

const base='https://kartoshka.free/v1';
const usernamePattern=/^[A-Za-z0-9_]{5,32}$/;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const envelope=body=>body?.result??body;
function freeLeft(body,headers){
 const header=headers?.get?.('x-free-remaining');if(header!==null&&header!==undefined&&/^\d+$/.test(header))return Number(header);
 const billing=envelope(body)?.billing;if(!billing||typeof billing!=='object')return null;
 for(const [key,value] of Object.entries(billing))if(/free.*(remaining|left)|(?:remaining|left).*free/i.test(key)&&Number.isFinite(Number(value)))return Number(value);
 return null;
}
function profileUsername(profile){
 if(!profile||typeof profile!=='object'||profile.hidden===true||profile.isHidden===true||profile.public===false||['hidden','blockchain'].includes(String(profile.type||profile.ownerType||'').toLowerCase()))return null;
 const direct=typeof profile.username==='string'?profile.username.replace(/^@/,''):null;
 if(direct&&usernamePattern.test(direct))return direct;
 const names=profile.usernames;
 if(Array.isArray(names))for(const item of names){if(item&&typeof item==='object'&&item.active===false)continue;const value=typeof item==='string'?item:item?.username;if(typeof value==='string'&&usernamePattern.test(value.replace(/^@/,'')))return value.replace(/^@/,'');}
 return null;
}
function giftOwner(result,requestedSlug){
 const gift=result?.gift??result?.item??result;
 const collection=gift?.slug??gift?.gift?.slug,number=gift?.num??gift?.gift?.num;
 const actualSlug=collection&&number!==undefined?`${collection}-${number}`:collection;
 if(actualSlug&&String(actualSlug).toLowerCase()!==requestedSlug.toLowerCase())return null;
 const owner=gift?.owner??gift?.currentOwner??gift?.current_owner??gift?.ownerProfile??gift?.owner_profile??gift?.current?.owner??result?.owner;
 const profile=owner?.profile??owner?.user??owner;
 const username=profileUsername(profile);if(!username)return null;
 const name=[profile.firstName??profile.first_name,profile.lastName??profile.last_name].filter(Boolean).join(' ').trim();
 return {username,...(name?{name}:{}),source:'see.tg API',giftSlug:requestedSlug};
}
export class SeeOwnerApi {
 constructor(store,env={}, {fetchImpl=globalThis.fetch,clock=now,minIntervalMs=1000}={}){
  Object.assign(this,{s:store,env,fetchImpl,clock,minIntervalMs});this.token=(env.SEE_API_TOKEN||'').trim();this.lastRequest=0;this.inflight=new Map();const fingerprint=this.token?createHash('sha256').update(this.token).digest('hex'):null;let old={};try{old=JSON.parse(this.s.one("SELECT value FROM meta WHERE key='see-owner-api'")?.value||'{}')}catch{}if(old.tokenFingerprint!==fingerprint)this.status({tokenFingerprint:fingerprint,error:null,freeRemaining:null,lastQuotaCheck:null,lastLookupAt:null,lastGiftSlug:null,ownerResolved:false});else this.status({configured:!!this.token});
 }
 get enabled(){if(!this.token||this.env.SEE_API_LOOKUPS_ENABLED!=='true')return false;let data={};try{data=JSON.parse(this.s.one("SELECT value FROM meta WHERE key='see-owner-api'")?.value||'{}')}catch{}return data.error!=='account_banned'}
 status(extra={}){if(!this.s)return;const old=this.s.one("SELECT value FROM meta WHERE key='see-owner-api'")?.value;let data={};try{data=JSON.parse(old||'{}')}catch{}this.s.run("INSERT INTO meta VALUES('see-owner-api',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify({...data,...extra,enabled:this.enabled,updatedAt:this.clock()}));}
 async request(path){
  const delay=this.minIntervalMs-(Date.now()-this.lastRequest);if(delay>0)await pause(delay);
  this.lastRequest=Date.now();
  return this.fetchImpl(base+path,{headers:{authorization:`Bearer ${this.token}`,accept:'application/json'},signal:AbortSignal.timeout(10000)});
 }
 async freeRemaining(){
  const response=await this.request('/me');if(response.status===403){this.status({error:'account_banned',freeRemaining:0});throw Error('account_banned')}if(!response.ok)throw Error(response.status===401?'invalid_token':`see_api_${response.status}`);
  const body=await response.json(),remaining=freeLeft(body,response.headers);
  this.status({freeRemaining:remaining,lastQuotaCheck:this.clock(),error:null});return remaining;
 }
 async lookupGift(slug){
  if(!this.enabled||!slug)return {owner:null,reason:'not_configured'};
  if(this.inflight.has(slug))return this.inflight.get(slug);
  const work=this.#lookupGift(slug).finally(()=>this.inflight.delete(slug));this.inflight.set(slug,work);return work;
 }
 async #lookupGift(slug){
  try{
   const remaining=await this.freeRemaining();
   // Never call a billable endpoint unless the API explicitly reports an unused free request.
   if(remaining===null){this.status({error:'free_quota_unknown'});return {owner:null,reason:'free_quota_unknown',retryAt:this.clock()+3600};}
   if(remaining<1){this.status({error:'free_quota_empty'});return {owner:null,reason:'free_quota_empty',retryAt:this.clock()+86400};}
   const response=await this.request('/gift/'+encodeURIComponent(slug));
   if(response.status===404){this.status({error:'gift_not_in_see_api'});return {owner:null,reason:'not_found',retryAt:this.clock()+86400};}
   if(response.status===429){const wait=Math.max(1,Number(response.headers.get('retry-after'))||60);this.status({error:'rate_limited'});return {owner:null,reason:'rate_limited',retryAt:this.clock()+wait};}
   if(response.status===402){this.status({freeRemaining:0,error:'free_quota_empty'});return {owner:null,reason:'free_quota_empty',retryAt:this.clock()+86400};}
   if(!response.ok){this.status({error:response.status===401?'invalid_token':'api_unavailable'});return {owner:null,reason:'api_unavailable',retryAt:this.clock()+3600};}
   const body=await response.json(),result=envelope(body),owner=giftOwner(result,slug);
   this.status({freeRemaining:freeLeft(body,response.headers),lastLookupAt:this.clock(),lastGiftSlug:slug,ownerResolved:!!owner,error:null});
   return owner?{owner,reason:'resolved'}:{owner:null,reason:'owner_hidden_or_username_unavailable',retryAt:this.clock()+86400};
  }catch(e){
   if(e?.message==='account_banned'){this.status({error:'account_banned',freeRemaining:0});return {owner:null,reason:'account_banned',retryAt:this.clock()+86400};}
   const code=e?.name==='TimeoutError'||e?.name==='AbortError'?'timeout':'network_error';this.status({error:code});
   return {owner:null,reason:code,retryAt:this.clock()+600};
  }
 }
}

export async function runSeeOwnerLookups({store,api,shouldStop,fetchPage=globalThis.fetch}){
 // Listings older than the publication freshness window cannot be posted.
 // Retire them first so a backlog never blocks newly detected gifts.
 const cutoff=new Date((now()-180)*1000).toISOString(),stamp=now();
 const publishedExpired=store.all("SELECT l.id FROM lots l JOIN publications p ON p.lot_id=l.id WHERE l.status IN ('free','stale') AND l.source IN ('see-tg','telegram-market') AND (json_extract(l.data,'$.ownerUsername') IS NULL OR json_extract(l.data,'$.observedAt') IS NULL OR json_extract(l.data,'$.observedAt')<?)",cutoff);
 store.tx(()=>{
  store.run("UPDATE lots SET status='stale' WHERE status='free' AND source IN ('see-tg','telegram-market') AND (json_extract(data,'$.observedAt') IS NULL OR json_extract(data,'$.observedAt')<? OR (json_extract(data,'$.ownerUsername') IS NULL AND id IN (SELECT lot_id FROM publications)))",cutoff);
  for(const lot of publishedExpired)store.enqueue('refresh-public',{id:lot.id},`refresh-public:${lot.id}:stale`);
  store.run("UPDATE jobs SET done=1,error='Объявление больше не актуально' WHERE done=0 AND kind='publish' AND json_extract(payload,'$.id') IN (SELECT id FROM lots WHERE source IN ('see-tg','telegram-market') AND status<>'free')");
  store.run("UPDATE jobs SET done=1,error='Ожидание совпадения See.tg перенесено в обработчик события' WHERE done=0 AND kind='publish' AND json_extract(payload,'$.id') IN (SELECT id FROM lots WHERE source='telegram-market' AND status='free' AND json_extract(data,'$.seeTgMatchedAt') IS NULL)");
  store.run("DELETE FROM see_owner_jobs WHERE lot_id IN (SELECT id FROM lots WHERE status<>'free' AND source IN ('see-tg','telegram-market'))");
  store.run("DELETE FROM see_owner_jobs WHERE lot_id IN (SELECT id FROM lots WHERE source='telegram-market' AND json_extract(data,'$.seeTgMatchedAt') IS NULL)");
  store.run('UPDATE see_owner_jobs SET next_at=? WHERE lot_id IN (SELECT id FROM lots WHERE status=\'free\')',stamp);
 });
 while(!shouldStop()){
  const current=now(),freshnessCutoff=new Date((current-180)*1000).toISOString();
  const job=store.one("SELECT q.lot_id,q.attempts,l.data FROM see_owner_jobs q JOIN lots l ON l.id=q.lot_id WHERE q.next_at<=? AND l.status='free' AND (l.source='see-tg' OR (l.source='telegram-market' AND json_extract(l.data,'$.seeTgMatchedAt') IS NOT NULL)) AND json_extract(l.data,'$.observedAt')>=? ORDER BY json_extract(l.data,'$.observedAt') DESC,q.lot_id DESC LIMIT 1",current,freshnessCutoff);
  if(!job){await pause(1000);continue;}
  let data;try{data=JSON.parse(job.data)}catch{store.run('DELETE FROM see_owner_jobs WHERE lot_id=?',job.lot_id);continue;}
  let enriched=await enrichGiftOwner(data,{fetchPage}),retryAt=now()+86400;
  if(!enriched.ownerUsername&&api?.enabled){
   const result=await api.lookupGift(data.slug);
   if(result.owner)enriched={...enriched,ownerUsername:result.owner.username,...(result.owner.name?{ownerName:result.owner.name}:{}),ownerUsernameSource:result.owner.source};
   if(result.retryAt)retryAt=result.retryAt;
  }
  if(enriched.ownerUsername){
   const current=store.one('SELECT data FROM lots WHERE id=?',job.lot_id);
   if(current){try{const updated=JSON.parse(current.data);if(!updated.ownerUsername){updated.ownerUsername=enriched.ownerUsername;updated.ownerUsernameSource=enriched.ownerUsernameSource;store.run('UPDATE lots SET data=? WHERE id=?',JSON.stringify(updated),job.lot_id)}store.run("UPDATE jobs SET next_at=0,error=NULL WHERE done=0 AND kind='publish' AND json_extract(payload,'$.id')=?",job.lot_id)}catch{}}
   store.run('DELETE FROM see_owner_jobs WHERE lot_id=?',job.lot_id);
  }else store.run('UPDATE see_owner_jobs SET attempts=attempts+1,next_at=? WHERE lot_id=?',retryAt,job.lot_id);
 }
}
