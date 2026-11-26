import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSeeEvent} from '../src/see-source.js';
import {Store} from '../src/store.js';
import {Service} from '../src/service.js';

const config=JSON.parse(readFileSync(new URL('../config.json',import.meta.url)));
const event=(kind='listing',price='555',at=new Date().toISOString())=>({type:'event',event:kind,market:'telegram',at,price:{amount:Number(price),currency:'xtr'},gift:{id:'1234567890123456789',slug:'PoolFloat',num:11,title:'Pool Float',model:'Air Bunny',resellAmountStars:price,resellAmountTon:'7920000000',owner_name:'@s***',owner_masked:true}});
function appSetup(){const s=new Store(),calls=[],tg={send:async(...a)=>{calls.push(['send',a]);return{message_id:100+calls.length}},call:async(...a)=>{calls.push(a);return{}}};return{s,calls,app:new Service(s,tg,config,{GROUP_ID:'-1001'})}}

test('see.tg listing normalizes gift fields and ignores masked owner names',()=>{
 const d=normalizeSeeEvent(event());assert.equal(d.kind,'listing');assert.equal(d.lot.source,'see-tg');assert.equal(d.lot.slug,'PoolFloat-11');assert.equal(d.lot.price,555);assert.equal(d.lot.currency,'XTR');assert.equal(d.lot.ton,7.92);assert.equal(d.lot.ownerUsername,undefined);assert.equal(d.lot.ownerName,undefined);
});
test('see.tg ignores other markets, invalid listings, and non-listing noise',()=>{
 assert.equal(normalizeSeeEvent({...event(),market:'fragment'}),null);assert.equal(normalizeSeeEvent({...event(),event:'sale'}),null);assert.equal(normalizeSeeEvent({...event(),gift:{}}),null);
});
test('new see.tg listing is published once; price changes edit the existing card',async()=>{
 const{s,calls,app}=appSetup(),first=normalizeSeeEvent(event());first.lot.ownerUsername='seller_public';await app.ingestSee(first);await app.work();assert.equal(calls.filter(c=>c[0]==='send').length,1);const repriced=normalizeSeeEvent(event('price','444'));repriced.lot.ownerUsername='seller_public';await app.ingestSee(repriced);assert.equal(s.one('SELECT count(*) n FROM lots').n,1);assert.equal(JSON.parse(s.one('SELECT data FROM lots').data).price,444);await app.work();assert.equal(calls.at(-1)[0],'editMessageText');assert.ok(calls.at(-1)[1].text.includes('444'));s.close();
});
test('see.tg listing waits in queue until a verified owner username exists',async()=>{
 const{s,calls,app}=appSetup();app.env.SOURCE='telegram';const lot=normalizeSeeEvent(event()).lot;
 s.run('INSERT INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)','see-tg','wait-user',JSON.stringify(lot),'standard');
 s.enqueue('publish',{id:1,source:'see-tg',chat:-1001,thread:2},'pub-wait-user');
 await app.work();assert.equal(calls.filter(c=>c[0]==='send').length,0);assert.equal(s.one('SELECT done FROM jobs WHERE unique_key=?','pub-wait-user').done,0);
 const resolved={...lot,ownerUsername:'seller_public'};s.run('UPDATE lots SET data=? WHERE id=1',JSON.stringify(resolved));s.run('UPDATE jobs SET next_at=0 WHERE unique_key=?','pub-wait-user');
 await app.work();assert.equal(calls.filter(c=>c[0]==='send').length,1);assert.equal(s.one('SELECT done FROM jobs WHERE unique_key=?','pub-wait-user').done,1);s.close();
});
test('Telegram market listing waits for the same see.tg slug and reuses one lot',async()=>{
 const{s,calls,app}=appSetup();app.env.SOURCE='telegram';const lot={...normalizeSeeEvent(event()).lot,source:'telegram-market',externalId:'telegram-market:PoolFloat-11'};
 s.run('INSERT INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)','telegram-market',lot.externalId,JSON.stringify(lot),'standard');s.enqueue('publish',{id:1,source:'telegram-market',chat:-1001,thread:2},'market:PoolFloat-11');
 await app.work();assert.equal(calls.filter(c=>c[0]==='send').length,0);assert.equal(s.one('SELECT error FROM jobs WHERE unique_key=?','market:PoolFloat-11').error,null);assert.equal(s.one('SELECT attempts FROM jobs WHERE unique_key=?','market:PoolFloat-11').attempts,0);
 await app.ingestSee({id:'match-1',kind:'listing',slug:lot.slug,at:new Date().toISOString(),lot:normalizeSeeEvent(event()).lot});
 assert.equal(s.one('SELECT count(*) n FROM lots WHERE json_extract(data,\'$.slug\')=?',lot.slug).n,1);const updated=JSON.parse(s.one('SELECT data FROM lots WHERE id=1').data);assert.equal(updated.seeTgMatchEventId,'match-1');
 await app.work();assert.equal(calls.filter(c=>c[0]==='send').length,0);const enriched={...updated,ownerUsername:'seller_public'};s.run('UPDATE lots SET data=? WHERE id=1',JSON.stringify(enriched));await app.work();assert.equal(calls.filter(c=>c[0]==='send').length,1);assert.match(calls.find(c=>c[0]==='send')[1][1],/Владелец:<\/b> <i>Скрыто/);s.close();
});
test('Telegram market lots enter the publish queue only after an exact See.tg match',async()=>{
 const{s,calls,app}=appSetup();app.env.SOURCE='telegram';const lot={...normalizeSeeEvent(event()).lot,source:'telegram-market',externalId:'telegram-market:new'};
 await app.ingest([lot]);assert.equal(s.one("select count(*) n from jobs where kind='publish' and done=0").n,0);
 const see=normalizeSeeEvent(event());await app.ingestSee(see);assert.equal(s.one("select count(*) n from jobs where kind='publish' and done=0").n,1);assert.equal(s.one('select count(*) n from see_owner_jobs').n,1);
 const job=JSON.parse(s.one("select payload from jobs where done=0 and kind='publish'").payload);assert.equal(job.source,'telegram-market');assert.equal(job.thread,3);assert.equal(calls.filter(c=>c[0]==='send').length,0);s.close();
});
test('see.tg delisting removes the claim button from an existing listing',async()=>{
 const{s,calls,app}=appSetup(),first=normalizeSeeEvent(event());first.lot.ownerUsername='seller_public';await app.ingestSee(first);await app.work();const delisted=normalizeSeeEvent(event('delisting'));await app.ingestSee(delisted);assert.equal(s.one('SELECT status FROM lots').status,'withdrawn');await app.work();assert.equal(calls.at(-1)[0],'editMessageText');assert.equal(calls.at(-1)[1].reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.startsWith('claim:')),false);s.close();
});
test('only see.tg listings are published in Telegram mode; old direct-market queue is ignored',async()=>{
 const{s,calls,app}=appSetup(),direct={...normalizeSeeEvent(event()).lot,source:'telegram-market',externalId:'old'};app.env.SOURCE='telegram';
 s.run('INSERT INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)','telegram-market','old',JSON.stringify(direct),'standard');
 const see={...normalizeSeeEvent(event()).lot,ownerUsername:'seller_public'};s.run('INSERT INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)','see-tg','new',JSON.stringify(see),'standard');
 s.enqueue('publish',{id:1,chat:-1001,thread:2},'pub-old');s.enqueue('publish',{id:2,source:'see-tg',chat:-1001,thread:2},'pub-see');
 await app.work();assert.equal(calls.filter(c=>c[0]==='send').length,1);assert.equal(s.one('SELECT done FROM jobs WHERE unique_key=?','pub-old').done,0);assert.equal(s.one('SELECT done FROM jobs WHERE unique_key=?','pub-see').done,1);assert.equal(s.one('SELECT lot_id FROM publications').lot_id,2);s.close();
});
