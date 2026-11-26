import {marketClient} from './market-client.js';
import {TelegramMarketSource,marketOptions} from './market-source.js';
import {scanMarket} from './market-runner.js';

const errorCode=e=>String(e.text||e.errorMessage||'');
export class AccountManager {
  constructor(store,env,{clientFactory=()=>marketClient(env),sourceFactory=client=>new TelegramMarketSource(store,client,marketOptions(env)),clock=()=>Date.now(),bootTimeoutMs=10000}={}) {
    Object.assign(this,{store,env,clientFactory,sourceFactory,clock,bootTimeoutMs});this.queue=Promise.resolve();this.source=null;this.flow=null;this.suspended=false;this.lastError='';this.nextBootAt=0;this.bootFailures=0;this.telegramFrozen=false;
  }
  exclusive(fn){const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result}
  async boot(){return this.exclusive(async()=>{if(this.source||this.flow||this.suspended||this.telegramFrozen||this.clock()<this.nextBootAt)return;let client,timer;try{client=await this.clientFactory();const self=await Promise.race([client.getMe(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('MTProto timeout')),this.bootTimeoutMs)})]);if(self.isBot)throw Error('bot');this.source=this.sourceFactory(client);this.account=self.displayName||String(self.id);this.lastError='';this.bootFailures=0;this.nextBootAt=0;}catch(e){await client?.destroy();const raw=String(e?.errorMessage||e?.text||e?.message||''),code=raw.match(/\b(?:RPC_[A-Z0-9_]+|AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_PASSWORD_NEEDED|USER_DEACTIVATED|FROZEN_METHOD_INVALID|FLOOD_WAIT_?\d*|MTProto timeout)\b/i)?.[0]||e?.name||'connection_error';this.lastError=code;this.telegramFrozen=code==='FROZEN_METHOD_INVALID';this.bootFailures++;this.nextBootAt=this.telegramFrozen?Number.MAX_SAFE_INTEGER:this.clock()+Math.min(300000,5000*2**Math.min(this.bootFailures-1,6));console.error(this.telegramFrozen?'Telegram заморозил подключённый аккаунт (FROZEN_METHOD_INVALID). Мониторинг остановлен; проверьте статус и возможность апелляции в официальном Telegram.':'Сессия Telegram-маркета временно недоступна ('+code+'); следующая попытка через '+Math.ceil((this.nextBootAt-this.clock())/1000)+' сек. Сохранённая сессия не удалена.');}finally{clearTimeout(timer)}})}
  status(){return this.telegramFrozen?'⛔ Аккаунт заморожен Telegram: мониторинг остановлен. Проверьте официальный Telegram и апелляцию.':this.source?`✅ Подключён: ${this.account}`:this.flow?`⏳ Ожидается ${this.flow.stage==='phone'?'номер':this.flow.stage==='code'?'код':'пароль 2FA'}`:'⚪ Аккаунт не подключён'}
  owns(uid){return this.flow?.uid===uid}
  async begin(uid){return this.exclusive(async()=>{
    if(this.source)throw Error('Сначала отключите текущий аккаунт.');
    if(this.flow&&this.flow.expires<=this.clock())await this.clear();
    if(this.flow&&this.flow.uid!==uid)throw Error('Другой администратор уже выполняет вход.');
    await this.clear();
    const client=await this.clientFactory();
    this.flow={uid,client,stage:'phone',expires:this.clock()+300000,attempts:0};
    this.timer=setTimeout(()=>{this.exclusive(()=>this.clear()).catch(()=>{})},300000);this.timer.unref?.();
    return 'Введите номер аккаунта в международном формате: +79991234567.\n/cancel — отмена. На вход отведено 5 минут.';
  })}
  async clear(){clearTimeout(this.timer);const f=this.flow;this.flow=null;await f?.client.destroy();}
  async cancel(uid){return this.exclusive(async()=>{if(this.flow&&this.flow.uid!==uid)throw Error('Этот вход запущен другим администратором.');await this.clear();})}
  async input(uid,text){return this.exclusive(async()=>{
    const f=this.flow;
    if(!f||f.uid!==uid)throw Error('Начните подключение заново.');
    if(f.expires<=this.clock()){await this.clear();throw Error('Время входа истекло. Начните заново.');}
    try {
      let self;
      if(f.stage==='phone'){
        if(!/^\+[1-9]\d{6,14}$/.test(text.trim()))throw Error('PHONE_FORMAT');
        f.phone=text.trim();
        const sent=await f.client.sendCode({phone:f.phone});
        if(sent.isBot!==undefined)self=sent;
        else {if(!['app','sms','call','flash_call','missed_call','email','fragment','sms_word','sms_phrase'].includes(sent.type))throw Error('DELIVERY_UNSUPPORTED');f.hash=sent.phoneCodeHash;f.stage='code';return `Код отправлен (способ: ${sent.type}). Введите полученный код вручную. Не пересылайте сообщение Telegram.\n/cancel — отмена.`;}
      } else if(f.stage==='code') {
        self=await f.client.signIn({phone:f.phone,phoneCodeHash:f.hash,phoneCode:text.trim()});
      } else self=await f.client.checkPassword({password:text});
      if(self.isBot)throw Error('BOT_ACCOUNT');
      const source=this.sourceFactory(f.client);clearTimeout(this.timer);this.flow=null;this.source=source;this.account=self.displayName||String(self.id);this.lastError='';
      return '✅ Аккаунт подключён. Мониторинг использует эту сессию без перезапуска бота.';
    } catch(e) {
      const code=errorCode(e)||e.message;
      if(code.includes('SESSION_PASSWORD_NEEDED')){f.stage='password';return 'На аккаунте включена защита. Введите пароль 2FA. /cancel — отмена.';}
      if(/PHONE_CODE_INVALID|PASSWORD_HASH_INVALID|PHONE_FORMAT|PHONE_NUMBER_INVALID/.test(code)&&++f.attempts<5) return code==='PHONE_FORMAT'?'Неверный формат. Введите номер с + и кодом страны.':'Неверный номер, код или пароль. Попробуйте ещё раз. /cancel — отмена.';
      await this.clear();
      throw Error(/PHONE_CODE_EXPIRED/.test(code)?'Код истёк. Начните подключение заново.':/FLOOD/.test(code)?'Telegram ограничил попытки входа. Попробуйте позднее.':'Вход не выполнен. Проверьте API ID/hash и возможность входа через стороннее приложение. Начните заново.');
    }
  })}
  async disconnect(){this.suspended=true;return this.exclusive(async()=>{try{await this.clear();if(this.source){await this.source.client.logOut();await this.source.close();this.source=null;this.account=null;}}finally{this.suspended=false;}})}
  async sweep(ingest,stop){if(!this.source&&!this.flow&&!this.suspended)await this.boot();let scanned=0,total=1,found=0;while(scanned<total&&!this.suspended&&!stop()){
    const r=await this.exclusive(async()=>{const source=this.source;if(!source)return {total:0,found:0};source.ownerIndex=this.ownerIndex;if(scanned===0)source.beginSweep();if(Date.now()<source.blockedUntil)return {total:source.ids.length||1,found:0,limited:true};const lots=await source.poll();await ingest(lots);source.commit();return {total:source.ids.length||1,found:lots.length};});
    total=r.total;found+=r.found;if(r.limited)return {scanned,total,found,limited:true};if(!total)break;scanned++;
  }return {scanned,total,found,limited:false};}
  get verifiedGift(){return this.source?.verifiedGift}
  get latestGift(){return this.source?.latestGift}
  async ownerRequest(request){return this.exclusive(async()=>{if(!this.source)throw Error('Аккаунт маркета не подключён.');return this.source.request(request);})}
  async verify(lot){return this.exclusive(async()=>{if(!this.source)throw Error('Аккаунт маркета не подключён.');this.source.ownerIndex=this.ownerIndex;return this.source.verify(lot);})}
  async close(){this.suspended=true;await this.exclusive(async()=>{await this.clear();await this.source?.close();this.source=null;})}
}
