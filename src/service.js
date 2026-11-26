import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {now} from './store.js';
import {card,buttons,hidden,kb,cb,esc,occupiedButton} from './cards.js';
import {validate} from './sources.js';
export class Service {
 constructor(store,tg,config,env){Object.assign(this,{s:store,tg,c:config,env});this.admins=(env.ADMIN_IDS||'').split(',').map(Number);}
 retireUnverifiedPublished(){const rows=this.s.all("SELECT l.id FROM lots l JOIN publications p ON p.lot_id=l.id WHERE l.source IN ('telegram-market','see-tg') AND l.status IN ('free','stale') AND json_extract(l.data,'$.ownerUsername') IS NULL ORDER BY l.id DESC");for(const {id} of rows){this.s.run("UPDATE lots SET status='stale' WHERE id=? AND status='free'",id);this.s.enqueue('refresh-public',{id},`refresh-public:${id}:missing-owner`);}return rows.length;}
 chat(tier){return Number(tier==='vip'&&this.env.VIP_GROUP_ID?this.env.VIP_GROUP_ID:this.env.GROUP_ID)}
 vipChat(){const id=Number(this.env.VIP_GROUP_ID)||0;return id!==Number(this.env.GROUP_ID)?id:0}
 enqueueRemoval(uid,chat){this.s.enqueue('remove',{uid,chat},`remove:${uid}:${chat}:${randomUUID()}`)}
 async channel(uid){if(!this.env.REQUIRED_CHANNEL_ID)return;const target=await this.tg.call('getChat',{chat_id:this.env.REQUIRED_CHANNEL_ID});if(!['channel','supergroup'].includes(target.type))throw Error('Неверно настроен обязательный канал. Администратору нужно исправить REQUIRED_CHANNEL_ID.');const m=await this.tg.call('getChatMember',{chat_id:this.env.REQUIRED_CHANNEL_ID,user_id:uid});if(!['member','administrator','creator'].includes(m.status)&&!(m.status==='restricted'&&m.is_member))throw Error('Сначала подпишитесь на обязательный канал');}
 async invite(uid,tier){const u=this.s.one('SELECT * FROM users WHERE id=?',uid);if(!this.s.active(uid,tier||'standard'))throw Error(tier==='vip'?'Сначала активируйте VIP-ключ.':'Сначала активируйте ключ доступа.');await this.channel(uid);const chat=this.chat(tier||u.tier);const cached=this.s.one('SELECT link FROM invites WHERE user_id=? AND chat_id=? AND expires>? AND expires<=? ORDER BY expires DESC LIMIT 1',uid,chat,now()+30,u.expires);if(cached)return cached.link;let group;try{group=await this.tg.call('getChat',{chat_id:chat})}catch{throw Error('Группа тарифа пока недоступна. Администратору нужно проверить GROUP_ID / VIP_GROUP_ID и добавить туда бота.')}
 if(group.type!=='supergroup'||!group.is_forum)throw Error('Для доступа нужна закрытая супергруппа с включёнными темами. Проверьте настройки группы тарифа.');
 let member;try{member=await this.tg.call('getChatMember',{chat_id:chat,user_id:uid})}catch(e){if(e.code!==400||!/member not found|user not found|USER_NOT_PARTICIPANT|PARTICIPANT_ID_INVALID/i.test(e.message))throw e;member={status:'left'};}
 if(member.status==='kicked')await this.tg.call('unbanChatMember',{chat_id:chat,user_id:uid,only_if_banned:true});const r=await this.tg.call('createChatInviteLink',{chat_id:chat,creates_join_request:true,expire_date:Math.min(u.expires,now()+3600),name:`user-${uid}`});this.s.run('INSERT INTO invites VALUES(?,?,?,?)',r.invite_link,uid,chat,Math.min(u.expires,now()+3600));return r.invite_link;}
 async menu(uid){const rows=[[cb('👑 Купить VIP канал','buy:vip')],[cb(`🎁 Тест платки (${this.c.trialSeconds/3600} ч.)`,'trial:standard'),cb(`⚡ VIP тест (${this.c.vipTrialSeconds/60} мин)`,'trial:vip')],[cb('💳 Купить платку','buy:standard')],[cb('🔑 Войти по ключу','code'),cb('🎁 Ввести промокод','code')],[cb('ℹ️ Моя подписка','sub'),cb('🔗 Новая ссылка','link')]];rows.push(await this.entryButtons(uid));if(this.admins.includes(uid)){this.adminKeyboardShown??=new Set();if(!this.adminKeyboardShown.has(uid)){await this.tg.send(uid,'Управление ботом доступно через кнопки ниже.',{reply_markup:{keyboard:[[{text:'⚙️ Админ-панель'}],[{text:'📱 Главное меню'}]],resize_keyboard:true,is_persistent:true,one_time_keyboard:false}});this.adminKeyboardShown.add(uid);}}return this.tg.send(uid,this.c.menuText.replace('{trialHours}',String(this.c.trialSeconds/3600)),{reply_markup:kb(rows)})}
 async entryButtons(uid){const row=[];for(const [tier,label] of [['standard','🚪 Войти в платку'],['vip','👑 Войти в VIP-группу']]){
   if(this.s.active(uid,tier)){try{row.push({text:label,url:await this.invite(uid,tier),style:'success'});}catch{row.push(cb('🔄 Ссылка: '+(tier==='vip'?'VIP':'платка'),'link:'+tier));}}
   else row.push(cb(label,'link:'+tier));
 }return row}
 async access(uid,tier,messageId){if(!this.s.active(uid,tier||'standard'))throw Error(tier==='vip'?'Сначала активируйте VIP-ключ.':'Сначала введите ключ доступа.');let text,rows;try{const link=await this.invite(uid,tier);text='✅ Доступ активирован. Нажмите кнопку ниже и подайте заявку — бот проверит вашу подписку и примет вас.';rows=[[{text:tier==='standard'?'🚪 Войти в платку':tier==='vip'?'👑 Войти в VIP-группу':'🚀 Войти в группу',url:link,style:'success'}],[cb('📱 Главное меню','menu')]];}catch(e){text='✅ Подписка активна.\n\n'+esc(e.message)+'\n\nПриглашение пока не удалось создать. Повторная активация ключа не нужна.';rows=[[cb('🔄 Повторить получение ссылки','link'+(tier?':'+tier:''))],[cb('📱 Главное меню','menu')]];}
 const extra={reply_markup:kb(rows)};if(messageId){try{return await this.tg.call('editMessageText',{chat_id:uid,message_id:messageId,text,parse_mode:'HTML',link_preview_options:{is_disabled:true},...extra})}catch(e){if(e.message.includes('message is not modified'))return;}}
 return this.tg.send(uid,text,extra)}
 async receipt(p){
   let l=p.licenseKey?this.s.one('SELECT * FROM license_keys WHERE key=? AND owner_id=?',p.licenseKey,p.uid):null;
   if(!l){const u=this.s.one('SELECT * FROM users WHERE id=?',p.uid);if(!u||!this.s.active(p.uid))return;l=this.s.tx(()=>this.s.issueLicense(p.uid,u.tier,Math.max(1,u.expires-now()),`legacy:${p.uid}:${u.expires}`,u.expires));}
   if(l.revoked)return;
   return this.tg.send(p.uid,`🔑 Ваш персональный ключ доступа\n\nТариф: ${esc(this.c.plans[l.tier].label)}\nСрок: ${Math.round(l.seconds/86400*100)/100} дней\n\n<code>${esc(l.key)}</code>\n\n${l.activated_at===null?'Нажмите «Войти по ключу» и отправьте этот ключ. Срок начнётся при первом вводе.':'Ваш ранее выданный доступ сохранён. Ввод ключа не добавит повторно дни.'}\nКлюч привязан к вашему Telegram-аккаунту.`,{protect_content:true,reply_markup:kb([[cb('🔑 Войти по ключу','code')],[cb('📱 Главное меню','menu')]])});
 }
  async ingest(lots){
   for(const raw of lots){
    let d=validate(raw);
    const topic=this.c.topics.find(t=>t.enabled!==false&&t.currency===d.currency&&d.price>=t.min&&d.price<t.max);
    if(!topic)continue;
    if(!topic.threadId)throw Error(`Укажите threadId для темы ${topic.name}`);
    const marketNeedsSeeMatch=this.env.SOURCE==='telegram'&&d.source==='telegram-market';
    if(marketNeedsSeeMatch&&d.slug){
     const match=this.s.one("SELECT id,kind,data FROM see_events WHERE slug=? AND received_at>=? ORDER BY received_at DESC,rowid DESC LIMIT 1",d.slug,now()-600);
     if(match&&match.kind!=='delisting'){const event=JSON.parse(match.data);d={...d,seeTgMatchedAt:event.at,seeTgMatchEventId:match.id};}
    }
    this.s.tx(()=>{
     const r=this.s.run('INSERT OR IGNORE INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)',d.source,d.externalId,JSON.stringify(d),topic.tier||'standard');
     if(!r.changes)return;
     const id=Number(r.lastInsertRowid);
     if(d.source==='telegram-market'&&d.slug)this.s.run("UPDATE lots SET status='superseded' WHERE source=? AND id<>? AND status='free' AND json_extract(data,'$.slug')=?",d.source,id,d.slug);
     // In Telegram mode, wait for a same-slug See.tg event before creating a publish job.
     if(!marketNeedsSeeMatch||d.seeTgMatchedAt)this.s.enqueue('publish',{id,source:d.source,chat:this.chat(topic.tier),thread:topic.threadId},`publish:${id}`);
     if(marketNeedsSeeMatch&&d.slug&&d.seeTgMatchedAt&&!d.ownerUsername)this.s.run('INSERT OR IGNORE INTO see_owner_jobs(lot_id) VALUES(?)',id);
    });
   }
  }
 async ingestSee(event){
  if(!event||!['listing','price','delisting'].includes(event.kind)||!event.slug)return;
  if(this.env.SOURCE==='telegram'){
   const market=this.s.one("SELECT * FROM lots WHERE source='telegram-market' AND json_extract(data,'$.slug')=? AND status='free' ORDER BY id DESC LIMIT 1",event.slug);
   if(!market)return;
   if(event.kind==='delisting'){
    this.s.tx(()=>{this.s.run("UPDATE lots SET status='withdrawn' WHERE id=? AND status='free'",market.id);this.s.run("UPDATE jobs SET done=1,error='Лот снят с продажи в see.tg' WHERE done=0 AND kind='publish' AND json_extract(payload,'$.id')=?",market.id);this.s.enqueue('refresh-public',{id:market.id},`refresh-public:${market.id}:see-delisting:${event.id}`);this.s.run('DELETE FROM see_owner_jobs WHERE lot_id=?',market.id)});return;
   }
    const old=JSON.parse(market.data),d={...old,seeTgMatchedAt:event.at,seeTgMatchEventId:event.id};
   if(event.lot&&event.kind==='price')Object.assign(d,{price:event.lot.price,priceText:event.lot.priceText,currency:event.lot.currency,ton:event.lot.ton,tonPriceText:event.lot.tonPriceText});
    const topic=this.c.topics.find(t=>t.enabled!==false&&t.currency===d.currency&&d.price>=t.min&&d.price<t.max);
    this.s.tx(()=>{
     this.s.run("UPDATE lots SET data=?,tier=? WHERE id=? AND status='free'",JSON.stringify(d),topic?.tier||market.tier,market.id);
     if(!d.ownerUsername)this.s.run('INSERT OR IGNORE INTO see_owner_jobs(lot_id) VALUES(?)',market.id);
     const pending=this.s.one("SELECT id FROM jobs WHERE done=0 AND kind='publish' AND json_extract(payload,'$.id')=? LIMIT 1",market.id);
     if(topic?.threadId){
      const payload=JSON.stringify({id:market.id,source:'telegram-market',chat:this.chat(topic.tier),thread:topic.threadId});
      if(pending)this.s.run('UPDATE jobs SET payload=?,next_at=0,error=NULL WHERE id=?',payload,pending.id);
      else this.s.enqueue('publish',JSON.parse(payload),`publish:${market.id}:see-match:${event.id}`);
     }
    });return;
  }
  const current=this.s.one("SELECT * FROM lots WHERE source='see-tg' AND json_extract(data,'$.slug')=? ORDER BY id DESC LIMIT 1",event.slug);
  if(event.kind==='delisting'){
   if(current?.status==='free'){
    this.s.tx(()=>{this.s.run("UPDATE lots SET status='withdrawn' WHERE id=? AND status='free'",current.id);this.s.enqueue('refresh-public',{id:current.id},`refresh-public:${current.id}:see-delisting:${event.id}`)});
   }
   return;
  }
  if(!event.lot)return;
  if(event.kind==='price'){
   // Price updates refresh an existing card. They are never announced as a new listing.
   if(current?.status==='free'){
    const old=JSON.parse(current.data),d={...old,...event.lot,externalId:old.externalId};
    if(old.price!==d.price||old.currency!==d.currency||old.priceText!==d.priceText){
     this.s.tx(()=>{this.s.run("UPDATE lots SET data=? WHERE id=? AND status='free'",JSON.stringify(d),current.id);this.s.enqueue('refresh-public',{id:current.id},`refresh-public:${current.id}:see-price:${event.id}`)});
    }
   }
   return;
  }
  // A listing event for a slug already present in a live or claimed card is not a second lot.
  if(current&&['free','claimed'].includes(current.status))return;
  const d=validate(event.lot),topic=this.c.topics.find(t=>t.enabled!==false&&t.currency===d.currency&&d.price>=t.min&&d.price<t.max);
  if(!topic)return;
  if(!topic.threadId)throw Error(`Укажите threadId для темы ${topic.name}`);
  this.s.tx(()=>{
   const r=this.s.run('INSERT OR IGNORE INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)','see-tg',event.id,JSON.stringify(d),topic.tier||'standard');
   if(r.changes){const id=Number(r.lastInsertRowid);this.s.enqueue('publish',{id,source:'see-tg',chat:this.chat(topic.tier),thread:topic.threadId},`publish:${id}`);this.s.run('INSERT OR IGNORE INTO see_owner_jobs(lot_id) VALUES(?)',id)}
  });
 }
 async work(){const publishFilter=this.env.SOURCE==='telegram'?" AND (kind<>'publish' OR (json_extract(payload,'$.source')='telegram-market' AND EXISTS (SELECT 1 FROM lots l WHERE l.id=json_extract(jobs.payload,'$.id') AND json_extract(l.data,'$.seeTgMatchedAt') IS NOT NULL AND json_extract(l.data,'$.ownerUsername') IS NOT NULL)) OR (json_extract(payload,'$.source')='see-tg' AND EXISTS (SELECT 1 FROM lots l WHERE l.id=json_extract(jobs.payload,'$.id') AND json_extract(l.data,'$.ownerUsername') IS NOT NULL)))":"";const jobs=this.s.all(`SELECT * FROM jobs WHERE done=0 AND next_at<=?${publishFilter} ORDER BY CASE WHEN kind='remove' THEN 0 WHEN kind='hide' THEN 1 WHEN kind='deliver' THEN 2 WHEN kind='refresh-public' AND unique_key LIKE 'refresh-public:%:missing-owner' THEN 3 WHEN kind='publish' THEN 4 WHEN kind='refresh-public' THEN 5 WHEN kind IN ('receipt','access-link') THEN 6 ELSE 7 END,CASE WHEN kind='refresh-public' AND unique_key LIKE 'refresh-public:%:missing-owner' THEN -CAST(json_extract(payload,'$.id') AS INTEGER) WHEN kind IN ('publish','refresh-public') THEN -id ELSE id END LIMIT 8`,now());for(const j of jobs){try{const p=JSON.parse(j.payload);if(this.env.SOURCE==='telegram'&&j.kind==='publish'&&['see-tg','telegram-market'].includes(p.source)){const lot=this.s.one('SELECT data FROM lots WHERE id=?',p.id);if(lot){const d=JSON.parse(lot.data);if(p.source==='telegram-market'&&!d.seeTgMatchedAt){this.s.run("UPDATE jobs SET next_at=?,error='Ждём совпадение этого подарка в ленте see.tg' WHERE id=?",now()+60,j.id);continue;}if(p.source==='see-tg'&&!d.ownerUsername){this.s.run('INSERT OR IGNORE INTO see_owner_jobs(lot_id) VALUES(?)',p.id);const q=this.s.one('SELECT next_at FROM see_owner_jobs WHERE lot_id=?',p.id),retryAt=Math.max(now()+60,Number(q?.next_at)||0);this.s.run("UPDATE jobs SET next_at=?,error='Ждём username владельца see.tg' WHERE id=?",retryAt,j.id);continue;}if(p.source==='telegram-market'&&!d.ownerUsername&&d.seeTgMatchedAt)this.s.run('INSERT OR IGNORE INTO see_owner_jobs(lot_id) VALUES(?)',p.id);}}if(j.kind==='publish'){const key='publish-after:'+p.chat,until=Number(this.s.one('SELECT value FROM meta WHERE key=?',key)?.value||0);if(until>now()){this.s.run('UPDATE jobs SET next_at=? WHERE id=?',until,j.id);continue;}await this.execute(j.kind,p);if(this.s.one('SELECT 1 FROM publications WHERE lot_id=?',p.id))this.s.run('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,String(now()+1));}else await this.execute(j.kind,p);this.s.run('UPDATE jobs SET done=1,error=NULL WHERE id=?',j.id)}catch(e){this.s.run('UPDATE jobs SET attempts=attempts+1,next_at=?,error=? WHERE id=?',now()+Math.max(e.retryAfter||0,Math.min(3600,2**Math.min(j.attempts+1,12))),String(e.message).slice(0,500),j.id)}}}
 async refreshPublic(id){const l=this.s.one('SELECT * FROM lots WHERE id=?',id),pub=this.s.one('SELECT * FROM publications WHERE lot_id=?',id);if(!l||!pub||l.status==='claimed')return;const d=JSON.parse(l.data),free=l.status==='free';try{await this.tg.call('editMessageText',{chat_id:pub.chat_id,message_id:pub.message_id,text:free?card(d):'⚪ Лот недоступен. Проверьте актуальное предложение на маркете.',parse_mode:'HTML',reply_markup:free?buttons(d,id):kb(d.giftUrl?[[{text:'Проверить подарок в Telegram',url:d.giftUrl}]]:[]),link_preview_options:free&&d.giftUrl?{url:d.giftUrl,prefer_large_media:true,show_above_text:true}:{is_disabled:true}})}catch(e){if(!e.message.includes('message is not modified'))throw e;}}
 async refreshLot(id,current){const l=this.s.one('SELECT * FROM lots WHERE id=?',id);if(!l||l.status==='claimed')return;if(current)this.s.run("UPDATE lots SET data=?,status='free' WHERE id=? AND status<>'claimed'",JSON.stringify({...current,externalId:JSON.parse(l.data).externalId}),id);else this.s.run("UPDATE lots SET status='withdrawn' WHERE id=? AND status<>'claimed'",id);try{await this.refreshPublic(id)}catch{this.s.enqueue('refresh-public',{id},'refresh-public:'+id+':'+randomUUID())}}
 async execute(kind,p){if(kind==='receipt')return this.receipt(p);if(kind==='access-link')return this.access(p.uid);if(kind==='remove'){const u=this.s.one('SELECT * FROM users WHERE id=?',p.uid);const needed=this.s.active(p.uid)&&(p.chat!==this.vipChat()||u.tier==='vip');if(needed)return;await this.tg.call('banChatMember',{chat_id:p.chat,user_id:p.uid});await this.tg.call('unbanChatMember',{chat_id:p.chat,user_id:p.uid,only_if_banned:true});this.s.run('DELETE FROM members WHERE user_id=? AND chat_id=?',p.uid,p.chat);return;}
 const l=this.s.one('SELECT * FROM lots WHERE id=?',p.id);if(!l)return;const d=JSON.parse(l.data),u=l.claimed_by?this.s.one('SELECT * FROM users WHERE id=?',l.claimed_by):null;
 if(kind==='refresh-public')return this.refreshPublic(p.id);
 if(kind==='publish'){if(l.status!=='free'||this.s.one('SELECT 1 FROM publications WHERE lot_id=?',p.id))return;const observed=Date.parse(d.observedAt);if(['telegram-market','see-tg'].includes(d.source)&&(!Number.isFinite(observed)||Date.now()-observed>180000)){this.s.run("UPDATE lots SET status='stale' WHERE id=? AND status='free'",p.id);return;}const m=await this.tg.send(p.chat,card(d),{message_thread_id:p.thread,reply_markup:buttons(d,p.id),link_preview_options:d.giftUrl?{url:d.giftUrl,prefer_large_media:true,show_above_text:true}:{is_disabled:true}});this.s.tx(()=>{this.s.run('INSERT INTO publications VALUES(?,?,?,?)',p.id,p.chat,m.message_id,p.thread);if(d.source==='telegram-market')this.ownerIndex?.queue(p.id)});this.ownerIndex?.preparePending();}
 if(kind==='hide'){const pub=this.s.one('SELECT * FROM publications WHERE lot_id=?',p.id);if(!pub)throw Error('Публикация ещё не сохранена');try{await this.tg.call('editMessageText',{chat_id:pub.chat_id,message_id:pub.message_id,text:hidden(u),parse_mode:'HTML',link_preview_options:{is_disabled:true},reply_markup:kb([[occupiedButton(u)]])})}catch(e){if(!e.message.includes('message is not modified'))throw e}}
 if(kind==='deliver')return this.tg.send(u.id,card(d,true),{reply_markup:buttons(d,p.id,true),link_preview_options:d.giftUrl?{url:d.giftUrl,prefer_large_media:true,show_above_text:false}:{is_disabled:true}});
 }
 expire(){for(const m of this.s.all('SELECT m.* FROM members m JOIN users u ON u.id=m.user_id WHERE u.expires<=? OR (m.chat_id=? AND u.tier<>?)',now(),this.vipChat(),'vip')){if(!this.s.one("SELECT 1 FROM jobs WHERE kind='remove' AND done=0 AND json_extract(payload,'$.uid')=? AND json_extract(payload,'$.chat')=?",m.user_id,m.chat_id))this.enqueueRemoval(m.user_id,m.chat_id)}}
 async update(v){
 if(v.chat_join_request){const r=v.chat_join_request,uid=r.from.id;const i=this.s.one('SELECT * FROM invites WHERE link=? AND user_id=? AND chat_id=? AND expires>?',r.invite_link?.invite_link||'',uid,r.chat.id,now());let ok=!!i&&this.s.active(uid,r.chat.id===this.vipChat()?'vip':'standard');if(ok)try{await this.channel(uid)}catch{ok=false}if(ok){this.s.run('INSERT OR IGNORE INTO members VALUES(?,?)',uid,r.chat.id);await this.tg.call('approveChatJoinRequest',{chat_id:r.chat.id,user_id:uid});await this.tg.call('revokeChatInviteLink',{chat_id:r.chat.id,invite_link:i.link});this.s.run('DELETE FROM invites WHERE link=?',i.link)}else await this.tg.call('declineChatJoinRequest',{chat_id:r.chat.id,user_id:uid});return;}
 if(v.pre_checkout_query){const q=v.pre_checkout_query,o=this.s.validOrder(q.from.id,q);return this.tg.call('answerPreCheckoutQuery',{pre_checkout_query_id:q.id,ok:!!o&&q.currency==='XTR',...(!o||q.currency!=='XTR'?{error_message:'Заказ недействителен'}:{})})}
 const m=v.message,q=v.callback_query,from=q?.from||m?.from;if(!from)return;const u=this.s.user(from);
 if(m?.successful_payment){this.s.pay(u.id,m.successful_payment);return}
 if(m?.chat.type!=='private'&&!q)return;
 if(q){try{const [action,arg]=q.data.split(':');if(action==='adm'){if(q.message?.chat.type!=='private')throw Error('Админ-панель доступна только в личном диалоге.');if(!this.panel)throw Error('Панель недоступна.');this.panel.check(u.id);await this.tg.call('answerCallbackQuery',{callback_query_id:q.id});return await this.panel.callback(u.id,arg);}if(action==='occupied')throw Error('Лот уже занят');if(action==='claim'){try{await this.tg.call('answerCallbackQuery',{callback_query_id:q.id,text:'⏳ Проверяю лот…'});}catch{}await this.channel(u.id);await this.beforeClaim?.(Number(arg));this.s.claim(Number(arg),u.id,this.c.plans[u.tier].cooldown);try{await this.tg.send(u.id,'✅ Лот закреплён за вами. Полная карточка уже поставлена в очередь доставки; если Telegram временно недоступен, бот повторит отправку автоматически.')}catch{}return}
 await this.tg.call('answerCallbackQuery',{callback_query_id:q.id});
 if(action==='menu')return this.menu(u.id);
 if(action==='trial'){await this.channel(u.id);this.s.trial(u.id,arg,arg==='vip'?this.c.vipTrialSeconds:this.c.trialSeconds);await this.tg.send(u.id,`🎉 Вам выдан бесплатный ${arg==='vip'?'VIP ':''}тест на ${arg==='vip'?this.c.vipTrialSeconds/60+' минут':this.c.trialSeconds/3600+' часа'}!\n\n• Кулдаун на занятие лотов: ${this.c.plans[arg].cooldown} секунд\n• Доступ к темам тарифа ${arg}`);return this.access(u.id)}
 if(action==='link')return this.access(u.id,arg,q.message?.chat.type==='private'?q.message.message_id:undefined);
 if(action==='code'){this.s.run("UPDATE users SET state='code' WHERE id=?",u.id);return this.tg.send(u.id,'Введите ключ или промокод. /cancel — отмена.')}
 if(action==='sub'){const active=this.s.active(u.id);return this.tg.send(u.id,active?`Тариф: ${esc(this.c.plans[u.tier].label)}\nДо: ${new Date(u.expires*1000).toLocaleString('ru-RU',{timeZone:this.c.timezone})} (${esc(this.c.timezone)})\nОсталось: ${Math.ceil((u.expires-now())/60)} мин\nКулдаун: ${this.c.plans[u.tier].cooldown} сек\nТемы: ${esc(this.c.topics.filter(t=>t.enabled!==false&&(t.tier!=='vip'||u.tier==='vip')).map(t=>t.name).join(', '))}`:'Активной подписки нет.')}
 if(action==='buy'){const plan=this.c.plans[arg];if(!plan)throw Error('Неизвестный тариф');if(this.s.active(u.id,'vip')&&arg==='standard')throw Error('Доступен только тариф VIP до завершения текущего доступа');const id=randomUUID();this.s.run('INSERT INTO orders VALUES(?,?,?,?,?,?,0)',id,u.id,arg,plan.stars,plan.seconds,now());return this.tg.call('sendInvoice',{chat_id:u.id,title:`Подписка ${plan.label}`,description:`Доступ на ${plan.seconds/86400} дней`,payload:id,currency:'XTR',prices:[{label:'Доступ',amount:plan.stars}],start_parameter:'subscription'})}
 }catch(e){try{await this.tg.call('answerCallbackQuery',{callback_query_id:q.id,text:e.message.slice(0,180),show_alert:true})}catch{}return this.tg.send(u.id,esc(e.message))}return;}
 if(m.text==='⚙️ Админ-панель'){if(!this.admins.includes(u.id))throw Error('Нет прав администратора.');return this.panel.show(u.id);}
 if(m.text==='📱 Главное меню')return this.menu(u.id);
 if(this.panel&&this.admins.includes(u.id)&&await this.panel.message(m))return;
 const text=m.text||'';if(text==='/start')return this.menu(u.id);if(text==='/cancel'){this.s.run('UPDATE users SET state=NULL WHERE id=?',u.id);return this.menu(u.id)}
 if(text==='/paysupport'||text==='/terms')return this.tg.send(u.id,esc(this.env.SUPPORT_TEXT||'Обратитесь к администратору группы. Бронь не является покупкой. Оплата относится только к доступу.'));
 if(text.startsWith('/admin'))return this.admin(u.id,text);
 if(u.state==='code'){this.s.redeem(u.id,text.trim());this.s.run('UPDATE users SET state=NULL WHERE id=?',u.id);return this.access(u.id)}
 return this.menu(u.id);
 }
 async admin(uid,text){if(!this.admins.includes(uid))throw Error('Нет прав администратора');const [,cmd,...a]=text.split(/\s+/);const positive=x=>{const n=Number(x);if(!Number.isSafeInteger(n)||n<=0)throw Error('Нужно положительное целое число');return n};
 if(!cmd&&this.panel)return this.panel.show(uid);
 if(cmd==='grant'){if(!this.c.plans[a[1]])throw Error('Тариф standard или vip');this.s.issueAccess(positive(a[0]),a[1],positive(a[2])*60,'admin:'+randomUUID())}
 else if(cmd==='revoke'){const id=positive(a[0]);this.s.revoke(id);this.expire()}
 else if(cmd==='code'){if(!this.c.plans[a[0]])throw Error('Тариф standard или vip');const code=randomUUID();this.s.code(code,a[0],positive(a[1])*60,now()+positive(a[2])*3600,positive(a[3]));return this.tg.send(uid,`Код: <code>${code}</code>`)}
 else if(cmd==='pause'||cmd==='resume')this.s.run("INSERT INTO meta VALUES('paused',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",cmd==='pause'?'1':'0');
 else if(cmd==='reload'){const c=JSON.parse(readFileSync(this.env.CONFIG_PATH||'config.json','utf8'));validateConfig(c);this.c=c;}
 else if(cmd==='refund'){await this.tg.call('refundStarPayment',{user_id:positive(a[0]),telegram_payment_charge_id:a[1]});this.s.revoke(Number(a[0]));this.expire();}
 else if(cmd==='stats'){let seeFeed={enabled:this.env.SOURCE==='telegram'&&this.env.SEE_FEED_ENABLED!=='false'},seeOwnerApi={configured:!!this.env.SEE_API_TOKEN};try{seeFeed={...seeFeed,...JSON.parse(this.s.one("SELECT value FROM meta WHERE key='see-feed'")?.value||'{}')}}catch{}try{seeOwnerApi={...seeOwnerApi,...JSON.parse(this.s.one("SELECT value FROM meta WHERE key='see-owner-api'")?.value||'{}')}}catch{}return this.tg.send(uid,esc(JSON.stringify({users:this.s.one('SELECT count(*) n FROM users'),lots:this.s.one('SELECT count(*) n FROM lots'),pending:this.s.one('SELECT count(*) n FROM jobs WHERE done=0'),seeFeed,seeOwnerApi,errors:this.s.all('SELECT id,kind,attempts,error FROM jobs WHERE done=0 AND error IS NOT NULL LIMIT 10')})));}
 else return this.tg.send(uid,'/admin grant USER_ID standard|vip MINUTES\n/admin revoke USER_ID\n/admin code standard|vip MINUTES VALID_HOURS MAX_USES\n/admin pause\n/admin resume\n/admin reload\n/admin stats\n/admin refund USER_ID CHARGE_ID');
 return this.tg.send(uid,'Готово.');
 }
}
const queuedWork=Service.prototype.work;
Service.prototype.work=async function(){
 const urgent=this.s.all("SELECT * FROM jobs WHERE done=0 AND next_at<=? AND kind IN ('receipt','access-link') ORDER BY id LIMIT 8",now());
 for(const j of urgent){try{await this.execute(j.kind,JSON.parse(j.payload));this.s.run('UPDATE jobs SET done=1,error=NULL WHERE id=?',j.id)}catch(e){this.s.run('UPDATE jobs SET attempts=attempts+1,next_at=?,error=? WHERE id=?',now()+Math.max(e.retryAfter||0,Math.min(3600,2**Math.min(j.attempts+1,12))),String(e.message).slice(0,500),j.id)}}
 return queuedWork.call(this);
};
export function validateConfig(c){for(const k of ['standard','vip']){const p=c.plans?.[k];if(!p||!Number.isInteger(p.stars)||p.stars<1||!Number.isInteger(p.seconds)||p.seconds<1||!Number.isFinite(p.cooldown)||p.cooldown<0)throw Error('Некорректный тариф '+k)}if(!Array.isArray(c.topics)||typeof c.menuText!=='string'||!(c.trialSeconds>0)||!(c.vipTrialSeconds>0))throw Error('Некорректная конфигурация');new Intl.DateTimeFormat('ru',{timeZone:c.timezone});for(const t of c.topics)if(t.enabled!==false&&(!['standard','vip'].includes(t.tier)||!Number.isInteger(t.threadId)||t.threadId<0||!(t.max>t.min)))throw Error('Некорректная тема');}
