import {readFileSync} from 'node:fs';
import {acquireProcessLock} from './process-lock.js';
import {Store} from './store.js';
import {Service,validateConfig} from './service.js';
import {Telegram} from './telegram.js';
import {DemoSource} from './sources.js';
import {AccountManager} from './account-manager.js';
import {AdminPanel} from './admin-panel.js';
import {inboxRecord} from './inbox.js';
import {LoginPortal} from './login-portal.js';
import {runMarket,scanInterval} from './market-runner.js';
import {topicsReady,missingTopics,autoSetupTopics} from './topic-settings.js';
import {PublicOwnerIndex,runOwnerIndex} from './owner-index.js';
import {SeeSource,runSeeFeed} from './see-source.js';
import {SeeOwnerApi,runSeeOwnerLookups} from './see-owner-api.js';
const env=process.env;
const intervalMs=scanInterval(env);
if(!env.BOT_TOKEN||!env.GROUP_ID||!env.ADMIN_IDS)throw Error('Заполните BOT_TOKEN, GROUP_ID, ADMIN_IDS в .env');
if(!['demo','telegram'].includes(env.SOURCE))throw Error('Укажите SOURCE=telegram или SOURCE=demo');
const config=JSON.parse(readFileSync(env.CONFIG_PATH||'config.json','utf8'));validateConfig(config);
if(!topicsReady(config))console.log('При запуске бот автоматически создаст недостающие темы: '+missingTopics(config).map(t=>t.name).join(', '));
const path=env.DB_PATH||'data/tracker.sqlite',lock=acquireProcessLock(path);
let s;
try{s=new Store(path)}catch(e){lock.release();throw e}
const tg=new Telegram(env.BOT_TOKEN),app=new Service(s,tg,config,env);
const retired=app.retireUnverifiedPublished();if(retired)console.log(`Снято с брони старых карточек без подтверждённого username: ${retired}`);
let stopped=false,source,marketTask,ownerTask,portal,bootTask,setupTask,seeTask,seeSource,seeOwnerTask,workTask;for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stopped=true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function telegramCallUntilConnected(method,data={}){let attempt=0;while(!stopped){try{return await tg.call(method,data)}catch(e){const delay=Math.min(30000,1000*2**Math.min(attempt++,5));console.error(`Telegram API ${method} недоступен: ${e.message}. Повтор через ${Math.ceil(delay/1000)} сек.`);await sleep(delay)}}throw Error('Остановка запрошена')}
try{
source=env.SOURCE==='telegram'?new AccountManager(s,env):new DemoSource();
app.seeOwnerApi=new SeeOwnerApi(s,env);
if(env.SOURCE==='telegram'){const index=new PublicOwnerIndex(s,r=>source.ownerRequest(r),{profiles:env.OWNER_PUBLIC_PROFILES||'',autoDiscovery:false,maxProfiles:Number(env.OWNER_MAX_PROFILES||5000)});app.ownerIndex=index;source.ownerIndex=index;}
app.panel=new AdminPanel(app,env.SOURCE==='telegram'?source:null);
if(env.SOURCE==='telegram'){try{portal=await new LoginPortal(source,app.admins,{port:Number(env.ADMIN_LOGIN_PORT||8765)}).start();app.panel.portal=portal;}catch{console.error('Форма подключения не запущена. Проверьте ADMIN_LOGIN_PORT. Остальные функции бота доступны.')}}
if(source.verify)app.beforeClaim=async id=>{const row=s.one('SELECT data,status FROM lots WHERE id=?',id);if(!row||row.status==='claimed')return;const d=JSON.parse(row.data);if(['telegram-market','see-tg'].includes(d.source)){let verified;try{verified=await source.verify(d)}catch(e){const age=Date.now()-Date.parse(d.observedAt||'');if(age>=0&&age<30000&&/timeout|timed out|network|connection|flood_wait/i.test(String(e.message))){console.warn(`Бронь ${id}: проверка маркета временно недоступна; использую недавний снимок лота.`);return}throw e}if(!verified){if(source.latestGift){await app.refreshLot(id,source.latestGift);return}await app.refreshLot(id,null);throw Error('Лот уже снят с продажи. Кнопка брони убрана.')}if(source.verifiedGift)s.run("UPDATE lots SET data=?,status='free' WHERE id=? AND status<>'claimed'",JSON.stringify({...source.verifiedGift,source:d.source,discoveredBy:d.discoveredBy}),id);if(d.source==='see-tg'&&!source.verifiedGift?.ownerUsername&&app.seeOwnerApi.enabled){const result=await app.seeOwnerApi.lookupGift(d.slug);if(result.owner){const latest=s.one('SELECT data FROM lots WHERE id=?',id);if(latest){const enriched=JSON.parse(latest.data);if(!enriched.ownerUsername){enriched.ownerUsername=result.owner.username;if(result.owner.name)enriched.ownerName=result.owner.name;enriched.ownerSource=result.owner.source;s.run('UPDATE lots SET data=? WHERE id=? AND status=\'free\'',JSON.stringify(enriched),id)}}}}}};
const me=await telegramCallUntilConnected('getMe');
const webhook=await telegramCallUntilConnected('getWebhookInfo');
if(webhook.url)await telegramCallUntilConnected('deleteWebhook',{drop_pending_updates:false});
console.log(`Бот @${me.username} подключён к Telegram. Ожидаю сообщения. SOURCE=${env.SOURCE}`);
s.run("INSERT INTO meta(key,value) VALUES('runtime',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify({build:'owner-discovery-v2',pid:process.pid,startedAt:new Date().toISOString()}));
// Neither MTProto initialization nor group setup should block bot updates.
if(source.boot)bootTask=source.boot().catch(()=>{console.error('Сессия маркета недоступна. Бот продолжает работу.')});
setupTask=(async()=>{while(!stopped){await autoSetupTopics(app);for(let i=0;i<4&&!stopped;i++)await new Promise(r=>setTimeout(r,250));}})();
// Run market polling separately so pagination and flood waits do not block bot updates.
if(env.SOURCE==='demo'){
 marketTask=runMarket({source,ingest:lots=>app.ingest(lots),shouldStop:()=>stopped,isPaused:()=>!topicsReady(app.c)||s.one("SELECT value FROM meta WHERE key='paused'")?.value==='1',intervalMs});
}else{
 console.log('Мониторинг новых объявлений включён через пользовательскую сессию Telegram; найденные подарки сверяются с see.tg перед публикацией.');
 marketTask=runMarket({source,ingest:lots=>app.ingest(lots),shouldStop:()=>stopped,isPaused:()=>!topicsReady(app.c)||s.one("SELECT value FROM meta WHERE key='paused'")?.value==='1',intervalMs});
}
if(env.SOURCE==='telegram'&&env.SEE_FEED_ENABLED!=='false'){
 seeSource=new SeeSource(s,env);
 seeTask=runSeeFeed({source:seeSource,app,shouldStop:()=>stopped,isPaused:()=>!topicsReady(app.c)||s.one("SELECT value FROM meta WHERE key='paused'")?.value==='1'});
 console.log('Лента see.tg включена: события используются для сверки лотов Telegram-маркета.');
}
if(env.SOURCE==='telegram'){seeOwnerTask=runSeeOwnerLookups({store:s,api:app.seeOwnerApi,shouldStop:()=>stopped});console.log(app.seeOwnerApi.enabled?'Проверка владельцев: See.tg REST включён и может расходовать дневную квоту.':'Проверка владельцев: только публичная страница Telegram; REST-запросы See.tg отключены.');}
while(!stopped){try{
 const offset=Number(s.one("SELECT value FROM meta WHERE key='offset'")?.value||0);
 const updates=await tg.call('getUpdates',{offset,timeout:2,allowed_updates:['message','callback_query','chat_join_request','pre_checkout_query']});
 const live=new Map(updates.map(v=>[v.update_id,v]));
 s.tx(()=>{for(const v of updates)s.run('INSERT OR IGNORE INTO inbox(id,data) VALUES(?,?)',v.update_id,inboxRecord(v,app.admins));if(updates.length)s.run("INSERT INTO meta VALUES('offset',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(updates.at(-1).update_id+1));});
 for(const row of s.all('SELECT * FROM inbox WHERE done=0 ORDER BY id LIMIT 50')){const saved=JSON.parse(row.data),v=live.get(row.id)||saved;try{if(v.admin_input_redacted){await tg.send(v.admin_id,'Ввод администратора не сохранён после перезапуска. Откройте /admin и повторите действие.');}else await app.update(v);s.run('UPDATE inbox SET done=1,error=NULL WHERE id=?',row.id)}catch(e){s.run('UPDATE inbox SET error=? WHERE id=?',saved.admin_input_redacted?'Ошибка обработки ввода администратора':String(e.message).slice(0,500),row.id);if(!v.message?.successful_payment){const uid=v.callback_query?.from.id||v.message?.from.id;if(uid)try{await tg.send(uid,'Ошибка: '+String(e.message).replaceAll('&','&amp;').replaceAll('<','&lt;'))}catch{}s.run('UPDATE inbox SET done=1 WHERE id=?',row.id)}}}
 app.expire();if(!workTask)workTask=app.work().catch(e=>console.error('Очередь фоновых задач:',e.message)).finally(()=>{workTask=null});
}catch(e){console.error(new Date().toISOString(),e.message);await new Promise(r=>setTimeout(r,3000))}}}finally{stopped=true;try{await workTask;await seeSource?.close();await portal?.close();await setupTask;await bootTask;await marketTask;await seeTask;await seeOwnerTask;await ownerTask;await source?.close?.();}finally{try{s.close()}finally{lock.release()}}}
