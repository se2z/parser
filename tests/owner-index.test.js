import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {PublicOwnerIndex} from '../src/owner-index.js';
import {Service} from '../src/service.js';
import {AdminPanel} from '../src/admin-panel.js';
import {TelegramMarketSource} from '../src/market-source.js';
const user={_:'user',id:42,accessHash:'123',username:'seller_name'};
const gift={_:'starGiftUnique',id:'71',slug:'Example-12',ownerId:{_:'peerUser',userId:42}};
const lot={source:'telegram-market',externalId:'one',slug:'Example-12',giftId:'71',name:'Example',price:555,currency:'XTR',ownerName:'Seller',observedAt:new Date().toISOString()};
const config=JSON.parse(readFileSync(new URL('../config.json',import.meta.url)));
const request=r=>r._==='contacts.resolveUsername'?{peer:{_:'peerUser',userId:42},users:[user]}:{gifts:[{gift}]};
test('public index fills before claim and public publication never exposes prepared contact',async()=>{
 const s=new Store(),messages=[],tg={send:async(chat,text,o)=>{messages.push({chat,text,o});return{message_id:1}},call:async()=>({})};
 const index=new PublicOwnerIndex(s,async r=>request(r),{profiles:'seller_name'}),app=new Service(s,tg,config,{GROUP_ID:'-100'});app.ownerIndex=index;
 await index.step();await app.ingest([lot]);await app.work();
 const prepared=JSON.parse(s.one('SELECT data FROM lots').data);assert.equal(prepared.ownerUsername,'seller_name');assert.equal(s.one('SELECT done FROM owner_preparations').done,1);
 assert.equal(messages.length,1);assert.equal(messages[0].text.includes('seller_name'),false);assert.equal(JSON.stringify(messages[0].o).includes('seller_name'),false);
 s.user({id:7,first_name:'Buyer'});s.grant(7,'vip',3600);s.claim(1,7,0);await app.execute('deliver',{id:1});assert.ok(messages.at(-1).text.includes('@seller_name'));assert.equal(messages.at(-1).chat,7);s.close();
});
test('contacts prepared after publication are retained in the persistent lot',async()=>{
 const s=new Store(),index=new PublicOwnerIndex(s,async r=>request(r),{profiles:'seller_name'});
 s.run('INSERT INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)',lot.source,lot.externalId,JSON.stringify(lot),'standard');index.queue(1);index.preparePending();assert.equal(s.one('SELECT done FROM owner_preparations').done,0);
 await index.step();index.preparePending();assert.equal(JSON.parse(s.one('SELECT data FROM lots').data).ownerUsername,'seller_name');s.close();
});
test('a handle in seller display name is checked against the exact public gift before use',async()=>{
 const s=new Store(),candidate={...lot,ownerName:'Marketplace seller | @seller_name'};s.run('INSERT INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)',candidate.source,candidate.externalId,JSON.stringify(candidate),'standard');
 const index=new PublicOwnerIndex(s,async r=>request(r));index.queue(1);assert.ok(s.one("SELECT 1 FROM owner_profile_sources WHERE username='seller_name' AND source='listing-owner-name-candidate'"));
 await index.step();index.preparePending();const enriched=JSON.parse(s.one('SELECT data FROM lots WHERE id=1').data);assert.equal(enriched.ownerUsername,'seller_name');assert.equal(enriched.ownerUsernameSource,'telegram-public-profile-inventory');s.close();
});
test('removed gifts are evicted after a completed profile scan and fail fresh confirmation',async()=>{
 const s=new Store();let time=10000,owned=true;const index=new PublicOwnerIndex(s,async r=>r._==='contacts.resolveUsername'?request(r):{gifts:owned?[{gift}]:[]},{profiles:'seller_name',clock:()=>time});
 await index.step();assert.ok(index.prepared(lot).ownerUsername);owned=false;assert.equal((await index.confirm(lot)).ownerUsername,undefined);
 time+=1801;await index.step();assert.equal(index.prepared(lot).ownerUsername,undefined);s.close();
});
test('page cursor and pending preparations survive reopening the database',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'owner-index-')),path=join(dir,'db.sqlite');let s=new Store(path);
 try{let index=new PublicOwnerIndex(s,async r=>r._==='contacts.resolveUsername'?request(r):{gifts:[{gift}],nextOffset:'second'},{profiles:'seller_name',clock:()=>10000});await index.step();s.close();s=new Store(path);let offset;
 index=new PublicOwnerIndex(s,async r=>{if(r._==='contacts.resolveUsername')return request(r);offset=r.offset;return{gifts:[]}},{clock:()=>10006});await index.step();assert.equal(offset,'second');assert.ok(index.prepared(lot).ownerUsername);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('hosting, wrong owner and hidden profile gifts never enter the owner index',async()=>{
 const s=new Store(),index=new PublicOwnerIndex(s,async r=>r._==='contacts.resolveUsername'?request(r):{gifts:[{gift:{...gift,ownerAddress:'wallet'}},{gift:{...gift,ownerId:undefined}},{gift:{...gift,ownerId:{_:'peerUser',userId:99}}},{gift:{...gift,hostId:{_:'peerUser',userId:42}}},{gift,unsaved:true}]},{profiles:'seller_name'});await index.step();assert.equal(s.one('SELECT count(*) n FROM owner_inventory').n,0);s.close();
});
test('FLOOD_WAIT pauses all profile indexing and survives index reconstruction',async()=>{
 const s=new Store();let count=0;const request=async()=>{count++;throw{seconds:120,text:'FLOOD_WAIT_120'}};let index=new PublicOwnerIndex(s,request,{profiles:'seller_name other_seller',clock:()=>10000});await assert.rejects(()=>index.step());index=new PublicOwnerIndex(s,request,{clock:()=>10005});await index.step();assert.equal(count,1);s.close();
});
test('only admins can add public seller profiles and invalid input is rejected',async()=>{
 const s=new Store(),app=new Service(s,{send:async()=>({})},config,{ADMIN_IDS:'1'});app.ownerIndex=new PublicOwnerIndex(s,async()=>({}));const p=new AdminPanel(app,null);
 await assert.rejects(()=>p.callback(2,'owners'),/прав/);await p.callback(1,'owners');await assert.rejects(()=>p.message({from:{id:1},text:'https://evil.test/name'}));await p.message({from:{id:1},text:'@seller_name, @Other_Seller'});assert.equal(s.one('SELECT count(*) n FROM owner_profiles').n,2);s.close();
});
test('claim verification rechecks prepared identity even when the direct gift API only returns a name',async()=>{
 const s=new Store(),index=new PublicOwnerIndex(s,async r=>request(r),{profiles:'seller_name'});await index.step();
 let visible=true;const current={...gift,ownerId:undefined,ownerName:'Seller',title:'Example',num:12,resellAmount:[{_:'starsAmount',amount:'555',nanos:0}]};
 const source=new TelegramMarketSource(s,{call:async r=>r._==='payments.getUniqueStarGift'?{gift:current}:r._==='contacts.resolveUsername'?request(r):{gifts:visible?[{gift}]:[]}},{fetchPage:async()=>new Response('',{status:404})});source.ownerIndex=index;
 const prepared=index.prepared(lot);assert.equal(await source.verify(prepared),true);assert.equal(source.verifiedGift.ownerUsername,'seller_name');
 visible=false;assert.equal(await source.verify(prepared),true);assert.equal(source.verifiedGift.ownerUsername,undefined);s.close();
});
test('public gift references automatically discover profiles and scan them without manual names',async()=>{
 const s=new Store(),other={...user,id:99,username:'next_seller'},otherGift={...gift,id:'72',slug:'Other-1',ownerId:{_:'peerUser',userId:99}};
 const rootGift={...gift,attributes:[{_:'starGiftAttributeOriginalDetails',senderId:{_:'peerUser',userId:99}}]};
 const index=new PublicOwnerIndex(s,async r=>{
  assert.ok(['contacts.resolveUsername','payments.getSavedStarGifts'].includes(r._));
  if(r._==='contacts.resolveUsername'){const e=r.username==='seller_name'?user:other;return{peer:{_:'peerUser',userId:e.id},users:[e]};}
  return r.peer.userId===42?{gifts:[{gift:rootGift}],users:[user,other,{...user,id:77,username:'unrelated_person'}]}:{gifts:[{gift:otherGift}],users:[other]};
 },{profiles:'seller_name'});
 await index.step();assert.ok(s.one('SELECT 1 FROM owner_profiles WHERE username=?','next_seller'));assert.equal(s.one('SELECT 1 FROM owner_profiles WHERE username=?','unrelated_person'),undefined);
 assert.equal(index.prepared({...lot,slug:'Other-1',giftId:'72'}).ownerUsername,undefined);
 await index.step();assert.equal(index.prepared({...lot,slug:'Other-1',giftId:'72'}).ownerUsername,'next_seller');assert.equal(index.prepared(lot).ownerUsername,'seller_name');
 assert.match(s.one('SELECT source FROM owner_profile_sources WHERE username=?','next_seller').source,/original-sender/);s.close();
});
test('a hidden gift sender is not discovered and publishers or unrelated response users are not owners',()=>{
 const s=new Store(),index=new PublicOwnerIndex(s,async()=>({}));
 index.discover({gifts:[{gift:{_: 'starGift',id:'1'},fromId:{_:'peerUser',userId:99},nameHidden:true},{...gift,ownerId:undefined,releasedBy:{_:'peerUser',userId:99}}],users:[{...user,id:99,username:'public_name'}]});
 assert.equal(s.one('SELECT count(*) n FROM owner_profiles').n,0);
 index.discover({gifts:[{gift:{_: 'starGift',id:'1'},fromId:{_:'peerUser',userId:99},nameHidden:false}],users:[{...user,id:99,username:'public_name'}]});assert.equal(s.one('SELECT count(*) n FROM owner_profiles').n,1);assert.equal(s.one('SELECT count(*) n FROM owner_inventory').n,0);s.close();
});
test('discovery can be disabled and automatic expansion respects the profile cap',()=>{
 const s=new Store(),response={gifts:[{...gift,ownerId:{_:'peerUser',userId:99}}],users:[{...user,id:99,username:'auto_name'}]};
 const index=new PublicOwnerIndex(s,async()=>({}),{profiles:'seller_name',autoDiscovery:false});index.discover(response);assert.equal(s.one('SELECT count(*) n FROM owner_profiles').n,1);
 index.autoDiscovery=true;index.maxProfiles=1;index.discover(response);assert.equal(s.one('SELECT count(*) n FROM owner_profiles').n,1);
 index.maxProfiles=2;index.discover(response);assert.equal(s.one('SELECT count(*) n FROM owner_profiles').n,2);s.close();
});
test('ownership observations retain actual changes without using historical owners as current contacts',async()=>{
 const s=new Store();let time=10000,id=42;
 const index=new PublicOwnerIndex(s,async r=>r._==='contacts.resolveUsername'?{peer:{_:'peerUser',userId:id},users:[{...user,id}]}:{gifts:[{gift:{...gift,ownerId:{_:'peerUser',userId:id}}}]},{profiles:'seller_name',clock:()=>time});
 await index.step();time+=1801;await index.step();assert.equal(s.one('SELECT count(*) n FROM owner_observations').n,1);
 time+=1801;id=99;await index.step();assert.equal(s.one('SELECT count(*) n FROM owner_observations').n,2);assert.equal(index.prepared(lot).ownerId,'99');assert.equal(s.one('SELECT owner_id FROM owner_observations ORDER BY id LIMIT 1').owner_id,'42');s.close();
});
