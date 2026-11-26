import {randomUUID} from 'node:crypto';
import {kb,cb,esc} from './cards.js';
import {now} from './store.js';
import {writeFileSync} from 'node:fs';
import {validateConfig} from './service.js';
import {TopicSettings,topicsReady} from './topic-settings.js';
import {profileNames} from './owner-index.js';
const pos=s=>{const n=Number(s);if(!Number.isSafeInteger(n)||n<1)throw Error('Введите положительное целое число.');return n};
export class AdminPanel {
  constructor(app,accounts){this.app=app;this.accounts=accounts;this.pending=new Map();this.topics=new TopicSettings(app,this)}
  check(uid){if(!this.app.admins.includes(uid))throw Error('Нет прав администратора.')}
  send(uid,text,rows=[]){return this.app.tg.send(uid,text,{protect_content:true,reply_markup:kb([...rows,[cb('⬅️ Админ-панель','adm:home')]])})}
  async show(uid){this.check(uid);this.pending.delete(uid);return this.send(uid,`⚙️ Админ-панель\n\n${esc(this.accounts?.status()||'Демонстрационный источник')}\nМониторинг: ${this.app.s.one("SELECT value FROM meta WHERE key='paused'")?.value==='1'?'пауза':!topicsReady(this.app.c)?'ожидает настройки тем':'включён'}`,[[cb('📱 Подключить аккаунт','adm:connect'),cb('🔌 Отключить','adm:disconnect')],[cb('👑 Выдать VIP','adm:grantvip'),cb('💳 Выдать обычный','adm:grantstandard')],[cb('🚫 Отозвать доступ','adm:revoke'),cb('👤 Проверить доступ','adm:lookup')],[cb('🔑 Создать код','adm:code'),cb('💰 Тарифы и кулдауны','adm:plans')],[cb('⏸ Пауза','adm:pause'),cb('▶️ Продолжить','adm:resume')],[cb('📊 Статистика','adm:stats'),cb('🔄 Обновить настройки','adm:reload')],[cb('📂 Темы группы','adm:topics'),cb('👤 Профили продавцов','adm:owners')],[cb('📱 Главное меню','menu')]])}
  async callback(uid,action){this.check(uid);
    if(action==='cancel'){this.pending.delete(uid);if(this.accounts?.owns(uid))await this.accounts.cancel(uid);return this.show(uid)}
    if(action==='home')return this.show(uid);
    if(action==='owners'){
      if(!this.app.ownerIndex)throw Error('Индекс доступен для источника Telegram.');
      if(this.accounts?.owns(uid))throw Error('Сначала завершите подключение аккаунта.');
      this.pending.set(uid,{action:'owners',expires:Date.now()+300000});
      const s=this.app.s,n=s.one('SELECT count(*) n FROM owner_profiles').n,g=s.one('SELECT count(*) n FROM owner_inventory').n;
      const discovered=s.one("SELECT count(DISTINCT username) n FROM owner_profile_sources WHERE source<>'manual'").n;
      return this.send(uid,`👤 Бесплатный индекс владельцев\n\nПрофилей: ${n}. Подарков в индексе: ${g}.\nАвтосбор: ${this.app.ownerIndex.autoDiscovery?'включён':'выключен'}. Автоматически обнаружено профилей: ${discovered}.\n\nБот добавляет профили из публичных данных подарков. Можно также отправить @username продавцов через пробел. Совпадение имени без подарка не считается подтверждением. Контакты показываются только в личной карточке после брони.`,[[cb('Отмена','adm:cancel')]]);
    }
    if(action==='revokeyes')return this.confirmRevoke(uid);
    if(action==='topicsmanual'){if(this.accounts?.owns(uid))throw Error('Сначала завершите подключение аккаунта или отмените его.');this.pending.set(uid,{action:'topicmanual',expires:Date.now()+300000});return this.send(uid,'Введите номер строки темы и её ID: например, 1 123.\nЧтобы выключить ненужную тему, укажите ID 0: 2 0.',[[cb('Отмена','adm:cancel')]])}
    if(action==='topics')return this.topics.show(uid);
    if(action==='topicscreate')return this.send(uid,'Создать в группе все включённые темы, у которых пока нет ID? Уже настроенные темы останутся прежними.',[[cb('Да, создать темы','adm:topicsyes'),cb('Отмена','adm:topics')]]);
    if(action==='topicsyes')return this.topics.create(uid);
    if(action==='connect'){if(!this.portal)throw Error('Форма подключения недоступна. Проверьте источник и порт панели.');this.pending.delete(uid);const link=await this.portal.open(uid);return this.send(uid,'📱 Подключение аккаунта\n\nОткройте форму на компьютере, где запущен бот: номер → код → пароль 2FA при необходимости. Без QR.\n\nTelegram аннулирует коды, отправленные в чат. Не присылайте код или пароль боту. Ссылка действует 5 минут.',[[{text:'Открыть форму входа',url:link}],[cb('Отмена входа','adm:cancel')]])}
    if(action==='disconnect')return this.send(uid,'Отключить аккаунт и завершить его сессию? Мониторинг остановится до нового подключения.',[[cb('Да, отключить','adm:disconnectyes'),cb('Отмена','adm:home')]]);
    if(action==='disconnectyes'){if(this.accounts)await this.accounts.disconnect();return this.show(uid)}
    if(['pause','resume','stats','reload'].includes(action)){await this.app.admin(uid,`/admin ${action}`);return this.show(uid)}
    if(this.accounts?.owns(uid))throw Error('Завершите подключение аккаунта или нажмите /cancel.');
    if(action==='plans'){this.pending.set(uid,{action:'plans',expires:Date.now()+300000});return this.send(uid,'Введите тариф, цену в Stars, длительность в днях и кулдаун в секундах.\nПример: vip 500 30 5',[[cb('Отмена','adm:cancel')]])}
    if(['grantvip','grantstandard','revoke','lookup','code'].includes(action)){
      this.pending.set(uid,{action,expires:Date.now()+300000});
      const prompt={grantvip:'Введите ID пользователя и срок VIP в днях, например: 123456789 30',grantstandard:'Введите ID пользователя и срок обычного доступа в днях: 123456789 30',revoke:'Введите ID пользователя для отзыва доступа.',lookup:'Введите ID пользователя для проверки подписки.',code:'Введите тариф, минуты доступа, срок действия кода в часах и число активаций. Например: vip 1440 24 10'}[action];
      return this.send(uid,prompt,[[cb('Отмена','adm:cancel')]]);
    }
    throw Error('Неизвестное действие.');
  }
  async message(m){const uid=m.from.id;this.check(uid);const text=m.text||'';
    if(text==='/cancel'){this.pending.delete(uid);if(this.accounts?.owns(uid))await this.accounts.cancel(uid);await this.show(uid);return true}
    if(this.accounts?.owns(uid)&&!text.startsWith('/')){
      let deleted=true;try{await this.app.tg.call('deleteMessage',{chat_id:uid,message_id:m.message_id})}catch{deleted=false}
      await this.send(uid,'Введите данные в форме по ссылке из панели. Код, отправленный сообщением, Telegram аннулирует.'+(deleted?'':'\nУдалите ваше сообщение вручную.'),[[cb('Отмена входа','adm:cancel')]]);return true;
    }
    if(text.startsWith('/'))return false;
    const p=this.pending.get(uid);if(!p)return false;
    if(p.expires<Date.now()){this.pending.delete(uid);throw Error('Время ввода истекло. Откройте админ-панель снова.')}
    const a=text.trim().split(/\s+/),s=this.app.s;
    if(p.action==='owners'){const names=profileNames(text);if(!names.length)throw Error('Введите хотя бы один @username.');this.app.ownerIndex.add(names.join(' '));this.pending.delete(uid);await this.send(uid,`Добавлено профилей для проверки: ${names.length}. Индекс обновляется в фоне.`);return true;}
    if(p.action==='topicmanual'){this.topics.manual(text);this.pending.delete(uid);await this.topics.show(uid);return true}
    if(p.action==='plans'){
      if(a.length!==4||!['vip','standard'].includes(a[0]))throw Error('Пример: vip 500 30 5');
      const c=structuredClone(this.app.c),days=pos(a[2]),cooldown=Number(a[3]);
      if(days>3650||!Number.isSafeInteger(cooldown)||cooldown<0||cooldown>86400)throw Error('Проверьте дни (до 3650) и кулдаун (0–86400).');
      c.plans[a[0]]={...c.plans[a[0]],stars:pos(a[1]),seconds:days*86400,cooldown};validateConfig(c);
      writeFileSync(this.app.env.CONFIG_PATH||'config.json',JSON.stringify(c,null,2)+'\n','utf8');this.app.c=c;this.pending.delete(uid);await this.send(uid,'Тариф сохранён. Новые счета используют новые условия.');return true;
    }
    if(p.action==='code'){
      if(!['vip','standard'].includes(a[0])||a.length!==4)throw Error('Пример: vip 1440 24 10');
      const code=randomUUID();s.code(code,a[0],pos(a[1])*60,now()+pos(a[2])*3600,pos(a[3]));this.pending.delete(uid);await this.send(uid,`Код создан: <code>${code}</code>`);return true;
    }
    const id=pos(a[0]),u=s.one('SELECT * FROM users WHERE id=?',id);if(!u)throw Error('Пользователь должен сначала нажать /start у бота.');
    if(p.action==='lookup'){this.pending.delete(uid);await this.send(uid,`ID: ${id}\nТариф: ${esc(u.tier)}\nАктивен: ${s.active(id)?'да':'нет'}\nДо: ${esc(new Date(u.expires*1000).toLocaleString('ru-RU',{timeZone:this.app.c.timezone}))}`);return true;}
    if(p.action==='revoke'){this.pending.set(uid,{action:'confirmrevoke',id,expires:Date.now()+300000});await this.send(uid,`Отозвать весь доступ у ${id}?`,[[cb('Да, отозвать','adm:revokeyes'),cb('Отмена','adm:cancel')]]);return true;}
    if(!['grantvip','grantstandard'].includes(p.action)||a.length!==2)throw Error('Введите ID и число дней.');
    const days=pos(a[1]);if(days>3650)throw Error('Максимум 3650 дней.');s.issueAccess(id,p.action==='grantvip'?'vip':'standard',days*86400,'admingrant:'+randomUUID());this.pending.delete(uid);
    await this.send(uid,`✅ Создан персональный ключ ${p.action==='grantvip'?'VIP':'обычного доступа'} для ${id} на ${days} дней. Ключ придёт пользователю в личный чат. Срок начнётся после его ввода.`);return true;
  }
  async confirmRevoke(uid){this.check(uid);const p=this.pending.get(uid);if(p?.action!=='confirmrevoke'||p.expires<Date.now())throw Error('Подтверждение истекло.');this.app.s.revoke(p.id);this.app.expire();this.pending.delete(uid);return this.send(uid,`Доступ пользователя ${p.id} и его ключи отозваны.`)}
}
