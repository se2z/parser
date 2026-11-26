import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {SeeOwnerApi,runSeeOwnerLookups} from '../src/see-owner-api.js';

const response=(body,{status=200,headers={}}={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});

test('see.tg owner lookup uses the exact gift endpoint and accepts its public username',async()=>{
 const s=new Store(),calls=[];const api=new SeeOwnerApi(s,{SEE_API_TOKEN:'test-token',SEE_API_LOOKUPS_ENABLED:'true'},{minIntervalMs:0,fetchImpl:async url=>{calls.push(String(url));if(String(url).endsWith('/me'))return response({ok:true,result:{billing:{freeRemaining:3}}},{headers:{'X-Free-Remaining':'3'}});return response({ok:true,result:{slug:'VictoryMedal-19258',owner:{type:'user',username:'out_kriss',firstName:'Out',lastName:'Kriss'}}},{headers:{'X-Free-Remaining':'2'}})}});
 const result=await api.lookupGift('VictoryMedal-19258');assert.equal(result.owner.username,'out_kriss');assert.equal(result.owner.name,'Out Kriss');assert.ok(calls.some(url=>url.endsWith('/gift/VictoryMedal-19258')));assert.ok(!calls.some(url=>url.includes('/who')));s.close();
});
test('see.tg lookup never calls billable gift endpoint when free quota is empty or unknown',async()=>{
 for(const remaining of ['0',null]){const s=new Store(),calls=[];const api=new SeeOwnerApi(s,{SEE_API_TOKEN:'token',SEE_API_LOOKUPS_ENABLED:'true'},{minIntervalMs:0,fetchImpl:async url=>{calls.push(String(url));return response({ok:true,result:{billing:remaining===null?{}:{freeRemaining:0}}},{headers:remaining===null?{}:{'X-Free-Remaining':remaining}})}});const result=await api.lookupGift('Gift-1');assert.equal(result.owner,null);assert.equal(calls.length,1);assert.ok(calls[0].endsWith('/me'));s.close();}
});
test('see.tg collection slug plus gift number resolves the exact public Telegram username',async()=>{
 const s=new Store();const api=new SeeOwnerApi(s,{SEE_API_TOKEN:'test-token',SEE_API_LOOKUPS_ENABLED:'true'},{minIntervalMs:0,fetchImpl:async url=>String(url).endsWith('/me')?response({ok:true,result:{billing:{freeRemaining:3}}},{headers:{'X-Free-Remaining':'3'}}):response({ok:true,result:{gift:{slug:'BDayCandle',num:42652,owner:{seeId:7,seeType:'user',telegramType:'user',telegramId:7,username:'unrealministr',name:'Owner'}}}},{headers:{'X-Free-Remaining':'2'}})});
 const result=await api.lookupGift('BDayCandle-42652');assert.equal(result.reason,'resolved');assert.equal(result.owner.username,'unrealministr');s.close();
});
test('hidden or mismatched owner data never becomes a username',async()=>{
 const s=new Store(),payloads=[{slug:'Gift-1',owner:{type:'hidden',username:'should_not_show'}},{slug:'Other-1',owner:{type:'user',username:'wrong_user'}}];let i=0;
 const api=new SeeOwnerApi(s,{SEE_API_TOKEN:'token',SEE_API_LOOKUPS_ENABLED:'true'},{minIntervalMs:0,fetchImpl:async url=>String(url).endsWith('/me')?response({ok:true,result:{billing:{freeRemaining:10}}},{headers:{'X-Free-Remaining':'10'}}):response({ok:true,result:payloads[i++]})});
 assert.equal((await api.lookupGift('Gift-1')).owner,null);assert.equal((await api.lookupGift('Gift-2')).owner,null);s.close();
});
test('no API token means no request is made',async()=>{const s=new Store();let calls=0;const api=new SeeOwnerApi(s,{}, {fetchImpl:async()=>{calls++}});assert.equal((await api.lookupGift('Gift-1')).reason,'not_configured');assert.equal(calls,0);s.close()});
test('a banned See app is disabled after a free /me check and is not retried per gift',async()=>{
 const s=new Store();let calls=0;const api=new SeeOwnerApi(s,{SEE_API_TOKEN:'test-token',SEE_API_LOOKUPS_ENABLED:'true'},{minIntervalMs:0,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({description:"Forbidden: the app owner's account is banned on see.tg"}),{status:403,headers:{'content-type':'application/json'}})}});
 assert.equal((await api.lookupGift('Gift-1')).reason,'account_banned');assert.equal(api.enabled,false);assert.equal(calls,1);assert.equal((await api.lookupGift('Gift-2')).reason,'not_configured');assert.equal(calls,1);s.close();
});
test('a newly configured See account clears a persisted ban from the previous token',()=>{
 const s=new Store();s.run("INSERT INTO meta VALUES('see-owner-api',?)",JSON.stringify({enabled:false,configured:true,error:'account_banned',freeRemaining:0}));const api=new SeeOwnerApi(s,{SEE_API_TOKEN:'replacement-token',SEE_API_LOOKUPS_ENABLED:'true'},{minIntervalMs:0,fetchImpl:async()=>new Response('{}')});assert.equal(api.enabled,true);const state=JSON.parse(s.one("SELECT value FROM meta WHERE key='see-owner-api'").value);assert.equal(state.error,null);assert.ok(state.tokenFingerprint);s.close();
});
test('without the See.tg API token only a public Telegram Owner link can supply the username',async()=>{
 const s=new Store(),lot={source:'see-tg',slug:'Gift-11',name:'Gift',price:10,currency:'XTR',ownerName:'Masked',observedAt:new Date().toISOString(),seeTgMatchedAt:new Date().toISOString()};
 s.run('INSERT INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)','see-tg','Gift-11',JSON.stringify(lot),'standard');
 s.enqueue('publish',{id:1,source:'see-tg',chat:-1001,thread:1},'publish:1');s.run('INSERT INTO see_owner_jobs(lot_id) VALUES(?)',1);
 let checks=0,requests=0;await runSeeOwnerLookups({store:s,shouldStop:()=>checks++>0,fetchPage:async()=>{requests++;return new Response('<table><tr><th>Owner</th><td><a href="https://t.me/sellerfree">Seller</a></td></tr></table>',{headers:{'content-type':'text/html'}})}});
 assert.equal(requests,1);assert.equal(JSON.parse(s.one('SELECT data FROM lots WHERE id=1').data).ownerUsername,'sellerfree');assert.equal(s.one('SELECT count(*) n FROM see_owner_jobs').n,0);s.close();
});
test('fresh See.tg feed listings are checked through the free owner API before publication',async()=>{
 const s=new Store(),lot={source:'see-tg',slug:'FreshSocks-116177',name:'Fresh Socks',price:10,currency:'XTR',observedAt:new Date().toISOString()};
 s.run('INSERT INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)','see-tg','FreshSocks-116177',JSON.stringify(lot),'standard');
 s.enqueue('publish',{id:1,source:'see-tg',chat:-1001,thread:1},'publish:1');s.run('INSERT INTO see_owner_jobs(lot_id) VALUES(?)',1);
 let stopped=false,calls=0;await runSeeOwnerLookups({store:s,api:{enabled:true,lookupGift:async slug=>{calls++;assert.equal(slug,'FreshSocks-116177');stopped=true;return {owner:{username:'kweenrl',source:'see.tg API'}}}},shouldStop:()=>stopped,fetchPage:async()=>new Response('',{status:404})});
 assert.equal(calls,1);assert.equal(JSON.parse(s.one('SELECT data FROM lots WHERE id=1').data).ownerUsername,'kweenrl');assert.equal(s.one('SELECT count(*) n FROM see_owner_jobs').n,0);assert.equal(s.one('SELECT next_at FROM jobs WHERE unique_key=?','publish:1').next_at,0);s.close();
});
test('See.tg REST lookups stay off unless explicitly enabled, even when a token exists',async()=>{
 const s=new Store();let calls=0;const api=new SeeOwnerApi(s,{SEE_API_TOKEN:'token'},{fetchImpl:async()=>{calls++}});assert.equal(api.enabled,false);assert.equal((await api.lookupGift('Gift-1')).reason,'not_configured');assert.equal(calls,0);s.close();
});
test('market owner lookup queue ignores Telegram listings until an exact See.tg match exists',async()=>{
 const s=new Store(),observedAt=new Date().toISOString();
 for(const [slug,match] of [['Unmatched-1',null],['Matched-2',observedAt]]){const data={source:'telegram-market',slug,name:slug,price:10,currency:'XTR',observedAt,...(match?{seeTgMatchedAt:match}:{})};const id=s.run('INSERT INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)','telegram-market',slug,JSON.stringify(data),'standard').lastInsertRowid;s.run('INSERT INTO see_owner_jobs(lot_id) VALUES(?)',id)}
 let stopped=false,calls=[];await runSeeOwnerLookups({store:s,api:{enabled:true,lookupGift:async slug=>{calls.push(slug);stopped=true;return {owner:{username:'verified_user',source:'see.tg API'}}}},shouldStop:()=>stopped,fetchPage:async()=>new Response('',{status:404})});
 assert.deepEqual(calls,['Matched-2']);assert.equal(s.one("select count(*) n from see_owner_jobs q join lots l on l.id=q.lot_id where json_extract(l.data,'$.slug')='Unmatched-1'").n,0);s.close();
});
test('expired published listing queues a card edit that removes its claim button',async()=>{
 const s=new Store(),old={source:'telegram-market',slug:'Gift-12',name:'Gift',price:10,currency:'XTR',ownerUsername:'seller',observedAt:new Date(Date.now()-300000).toISOString()};
 s.run('INSERT INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)','telegram-market','Gift-12',JSON.stringify(old),'standard');s.run('INSERT INTO publications VALUES(1,-100,42,7)');
 await runSeeOwnerLookups({store:s,shouldStop:()=>true});assert.equal(s.one('SELECT status FROM lots WHERE id=1').status,'stale');assert.equal(s.one('SELECT kind FROM jobs WHERE unique_key=?','refresh-public:1:stale').kind,'refresh-public');s.close();
});
test('published listing without a confirmed username is retired and edited',async()=>{
 const s=new Store(),current={source:'telegram-market',slug:'Gift-13',name:'Gift',price:10,currency:'XTR',observedAt:new Date().toISOString()};
 s.run('INSERT INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)','telegram-market','Gift-13',JSON.stringify(current),'standard');s.run('INSERT INTO publications VALUES(1,-100,43,7)');
 await runSeeOwnerLookups({store:s,shouldStop:()=>true});assert.equal(s.one('SELECT status FROM lots WHERE id=1').status,'stale');assert.equal(s.one('SELECT kind FROM jobs WHERE unique_key=?','refresh-public:1:stale').kind,'refresh-public');s.close();
});
test('startup retires legacy pending posts for stale, superseded, and unmatched listings',async()=>{
 const s=new Store(),oldDate=new Date(Date.now()-600000).toISOString(),freshDate=new Date().toISOString();
 for(const [slug,status,data,payload] of [
  ['LegacyOld','free',{source:'telegram-market',slug:'LegacyOld-1',observedAt:oldDate},{id:1}],
  ['LegacySuperseded','superseded',{source:'telegram-market',slug:'LegacySuperseded-1',observedAt:freshDate},{id:2}],
  ['LegacyUnmatched','free',{source:'telegram-market',slug:'LegacyUnmatched-1',observedAt:freshDate},{id:3,source:'telegram-market'}],
 ]){const id=s.run('INSERT INTO lots(source,external_id,data,tier,status) VALUES(?,?,?,?,?)','telegram-market',slug,JSON.stringify(data),'standard',status).lastInsertRowid;s.enqueue('publish',payload,`publish:${id}`)}
 await runSeeOwnerLookups({store:s,shouldStop:()=>true});assert.equal(s.one('select done from jobs where unique_key=?','publish:1').done,1);assert.equal(s.one('select done from jobs where unique_key=?','publish:2').done,1);assert.equal(s.one('select done from jobs where unique_key=?','publish:3').done,1);s.close();
});
