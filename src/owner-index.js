import {randomUUID} from 'node:crypto';
import {now} from './store.js';
import {ownerFromPublicProfile} from './owner-profile.js';
export function profileNames(text){
 const names=String(text||'').split(/[\s,;]+/).filter(Boolean).map(n=>n.replace(/^@/,'').toLowerCase());
 if(names.length>100||names.some(n=>!/^[a-z][a-z0-9_]{3,31}$/.test(n)))throw Error('Введите до 100 публичных @username через пробел.');
 return [...new Set(names)];
}
export class PublicOwnerIndex {
 constructor(s,request,{profiles='',clock=now,autoDiscovery=true,maxProfiles=5000}={}){if(!Number.isInteger(maxProfiles)||maxProfiles<1||maxProfiles>100000)throw Error('OWNER_MAX_PROFILES: укажите число от 1 до 100000');Object.assign(this,{s,request,clock,autoDiscovery,maxProfiles});this.add(profiles);}
 blocked(){return Number(this.s.one("SELECT value FROM meta WHERE key='owner-index-blocked'")?.value||0)>this.clock();}
 add(text,{source='manual',reference=''}={}){for(const name of profileNames(text)){
  if(source!=='manual'&&!this.s.one('SELECT 1 FROM owner_profiles WHERE username=?',name)&&this.s.one('SELECT count(*) n FROM owner_profiles').n>=this.maxProfiles)continue;
  this.s.run('INSERT OR IGNORE INTO owner_profiles(username) VALUES(?)',name);
  this.s.run('INSERT OR IGNORE INTO owner_profile_sources VALUES(?,?,?,?)',name,source,String(reference).slice(0,160),this.clock());
 }}
 discover(response,{source='public-profile',reference=''}={}){
  if(!this.autoDiscovery)return;
  const peers=new Map(),key=p=>p?._==='peerUser'?'user:'+p.userId:p?._==='peerChannel'?'channel:'+p.channelId:null;
  const remember=(p,role)=>{const k=key(p);if(k)peers.set(k,role)};
  for(const item of response.gifts||[response.gift].filter(Boolean)){
   const g=item.gift||item;if(!['starGift','starGiftUnique'].includes(g._))continue;
   if(item.gift&&!item.nameHidden)remember(item.fromId,'sender');
   if(g._!=='starGiftUnique')continue;
   if(!g.ownerAddress&&!g.hostId)remember(g.ownerId,'owner');
   for(const a of g.attributes||[])if(a._==='starGiftAttributeOriginalDetails'){
    remember(a.senderId,'original-sender');remember(a.recipientId,'original-recipient');
   }
  }
  for(const [kind,entities] of [['user',response.users||[]],['channel',response.chats||[]]])for(const e of entities){
   const role=peers.get(kind+':'+e.id),name=e.username||e.usernames?.find(n=>n.active)?.username;
   if(!role||!name||e.deleted||e.bot||e.min||/Forbidden$/.test(e._||''))continue;
   try{this.add(name,{source:source+':'+role,reference})}catch{}
  }
 }
 queue(id){
  this.s.run('INSERT OR IGNORE INTO owner_preparations(lot_id) VALUES(?)',id);
  const row=this.s.one('SELECT data FROM lots WHERE id=?',id);if(row){const d=JSON.parse(row.data);if(!this.autoDiscovery)return;const names=new Set([...(d.ownerUsername?[d.ownerUsername]:[]),...[...String(d.ownerName||'').matchAll(/@([a-z][a-z0-9_]{3,31})/ig)].map(m=>m[1])]);for(const name of names)try{this.add(name,{source:'listing-owner-name-candidate',reference:d.slug||''})}catch{}}
 }
 queueRecent(limit=500){const cutoff=new Date((this.clock()-180)*1000).toISOString();for(const row of this.s.all("SELECT id FROM lots WHERE source='telegram-market' AND status='free' AND json_extract(data,'$.ownerName') LIKE '%@%' AND json_extract(data,'$.observedAt')>=? ORDER BY id DESC LIMIT ?",cutoff,limit))this.queue(row.id)}
 candidate(lot){
  if(lot.ownerAddress||!lot.slug)return null;
  const x=this.s.one('SELECT * FROM owner_inventory WHERE slug=? AND observed_at>?',lot.slug,this.clock()-21600);
  return x&&(!lot.giftId||lot.giftId===x.gift_id)&&(!lot.ownerId||lot.ownerId===x.owner_id)?x:null;
 }
 prepared(lot){const x=this.candidate(lot);return x?{...lot,ownerUsername:x.username,ownerId:x.owner_id,ownerUsernameSource:'telegram-public-profile-inventory',ownerVerifiedAt:new Date(x.observed_at*1000).toISOString(),...(x.premium===null?{}:{premium:!!x.premium})}:lot;}
 async confirm(lot,request=this.request){
  if(lot.ownerUsername||this.blocked())return lot;
  const x=this.candidate(lot);if(!x)return lot;
  let confirmed;try{confirmed=await ownerFromPublicProfile({...lot,ownerName:'@'+x.username},request,{initialOffset:x.page_offset});}catch(e){const sec=Number(e.seconds)||Number(String(e.text||'').match(/FLOOD_(?:PREMIUM_)?WAIT_?(\d+)/)?.[1]);if(sec)this.s.run("INSERT INTO meta VALUES('owner-index-blocked',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(this.clock()+sec));throw e;}
  return confirmed.ownerUsername?{...confirmed,ownerName:lot.ownerName,ownerVerifiedAt:new Date(this.clock()*1000).toISOString()}:lot;
 }
 preparePending(){
  for(const p of this.s.all('SELECT lot_id FROM owner_preparations WHERE done=0 ORDER BY lot_id DESC LIMIT 500')){
   const row=this.s.one('SELECT data,status FROM lots WHERE id=?',p.lot_id);
   if(!row||row.status!=='free'){this.s.run('UPDATE owner_preparations SET done=1 WHERE lot_id=?',p.lot_id);continue;}
   const d=JSON.parse(row.data),enriched=d.ownerUsername?d:this.prepared(d);
   if(enriched.ownerUsername)this.s.tx(()=>{this.s.run("UPDATE lots SET data=? WHERE id=? AND status='free'",JSON.stringify(enriched),p.lot_id);this.s.run('UPDATE owner_preparations SET done=1,prepared_at=? WHERE lot_id=?',this.clock(),p.lot_id);});
  }
 }
 async step(){
  if(this.blocked())return;
  const p=this.s.one("SELECT p.* FROM owner_profiles p WHERE p.next_at<=? ORDER BY CASE WHEN EXISTS(SELECT 1 FROM owner_profile_sources s WHERE s.username=p.username AND s.source='listing-owner-name-candidate') THEN 0 ELSE 1 END,p.next_at,p.username LIMIT 1",this.clock());if(!p)return;
  try{
   const resolved=await this.request({_: 'contacts.resolveUsername',username:p.username});
   const isUser=resolved.peer?._==='peerUser',isChannel=resolved.peer?._==='peerChannel';
   if(!isUser&&!isChannel)throw Error('Публичный профиль не найден');
   const id=isUser?resolved.peer.userId:resolved.peer.channelId;
   const e=(isUser?resolved.users:resolved.chats)?.find(e=>String(e.id)===String(id));
   const username=e?.username||e?.usernames?.find(n=>n.active)?.username;
   if(!username||!e.accessHash||e.min||e.deleted)throw Error('Публичный профиль недоступен');
   const peer=isUser?{_: 'inputPeerUser',userId:id,accessHash:e.accessHash}:{_: 'inputPeerChannel',channelId:id,accessHash:e.accessHash};
   const r=await this.request({_: 'payments.getSavedStarGifts',peer,excludeUnsaved:true,excludeUnlimited:true,excludeHosted:true,offset:p.next_offset,limit:100});
   const gen=p.next_offset?p.generation:randomUUID(),next=r.nextOffset&&r.nextOffset!==p.next_offset?r.nextOffset:'';
   this.s.tx(()=>{
    for(const saved of r.gifts||[]){
     const g=saved.gift,ownerId=g?.ownerId?.userId??g?.ownerId?.channelId;
     if(saved.unsaved||saved.refunded||g?._!=='starGiftUnique'||!g.slug||g.ownerAddress||g.hostId||String(ownerId)!==String(id))continue;
     this.s.run('INSERT INTO owner_inventory VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET gift_id=excluded.gift_id,profile=excluded.profile,owner_id=excluded.owner_id,username=excluded.username,premium=excluded.premium,observed_at=excluded.observed_at,generation=excluded.generation,page_offset=excluded.page_offset',g.slug,String(g.id),p.username,String(id),username,isUser?Number(!!e.premium):null,this.clock(),gen,p.next_offset);
     const last=this.s.one('SELECT id,owner_id,username FROM owner_observations WHERE slug=? ORDER BY id DESC LIMIT 1',g.slug);
     if(last?.owner_id===String(id)&&last.username===username)this.s.run('UPDATE owner_observations SET last_seen=? WHERE id=?',this.clock(),last.id);
     else this.s.run('INSERT INTO owner_observations(slug,gift_id,owner_id,username,first_seen,last_seen) VALUES(?,?,?,?,?,?)',g.slug,String(g.id),String(id),username,this.clock(),this.clock());
    }
    if(!next)this.s.run('DELETE FROM owner_inventory WHERE profile=? AND generation<>?',p.username,gen);
    this.s.run('UPDATE owner_profiles SET next_offset=?,generation=?,next_at=?,last_error=NULL WHERE username=?',next,gen,this.clock()+(next?5:1800),p.username);
    this.discover(r,{source:'public-profile',reference:p.username});
   });
  }catch(e){const flood=Number(e.seconds)||Number(String(e.text||'').match(/FLOOD_(?:PREMIUM_)?WAIT_?(\d+)/)?.[1]),sec=flood||(/USERNAME_INVALID|USERNAME_NOT_OCCUPIED/.test(e.text||'')?86400:60);this.s.run('UPDATE owner_profiles SET next_at=?,last_error=? WHERE username=?',this.clock()+sec,'Публичный профиль временно недоступен',p.username);if(flood)this.s.run("INSERT INTO meta VALUES('owner-index-blocked',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(this.clock()+sec));throw e;}
 }
}
export async function runOwnerIndex(index,stop,{report=console.error}={}){
 while(!stop()){
  try{await index.step();index.preparePending();}catch{report('Индекс владельцев: пауза после ошибки или ограничения Telegram.');}
  const until=Date.now()+5000;while(!stop()&&Date.now()<until)await new Promise(r=>setTimeout(r,250));
 }
}
