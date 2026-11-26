import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const now=()=>Math.floor(Date.now()/1000);
export const hash=s=>createHash('sha256').update(s).digest('hex');
export class Store {
 constructor(path=':memory:') {if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=5000');for(const file of ['001.sql','002-owner-index.sql','003-owner-discovery.sql','004-see-feed.sql','005-see-owner-api.sql','006-job-queue.sql'])this.db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));}
 one(sql,...p){return this.db.prepare(sql).get(...p)}
 all(sql,...p){return this.db.prepare(sql).all(...p)}
 run(sql,...p){return this.db.prepare(sql).run(...p)}
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r}catch(e){this.db.exec('ROLLBACK');throw e}}
 user(u){this.run('INSERT INTO users(id,username,name) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,name=excluded.name',u.id,u.username||null,u.first_name||String(u.id));return this.one('SELECT * FROM users WHERE id=?',u.id)}
 active(id,tier='standard',t=now()){const u=this.one('SELECT * FROM users WHERE id=?',id);return !!u&&u.expires>t&&(tier!=='vip'||u.tier==='vip')}
 grant(id,tier,seconds,t=now()) {const u=this.one('SELECT * FROM users WHERE id=?',id);if(!u)throw Error('Пользователь должен сначала нажать /start');if(u.expires>t&&u.tier==='vip'&&tier==='standard')throw Error('Сначала дождитесь окончания VIP или продлите VIP');this.run('UPDATE users SET tier=?,expires=? WHERE id=?',tier,Math.max(u.expires,t)+seconds,id);}
 trial(id,kind,seconds){return this.tx(()=>{if(this.active(id))throw Error('У вас уже есть активная подписка');if(this.one('SELECT 1 FROM trials WHERE user_id=? AND kind=?',id,kind))throw Error('Этот тест уже использован');this.run('INSERT INTO trials VALUES(?,?)',id,kind);this.grant(id,kind,seconds)})}
 enqueue(kind,payload,key){this.run('INSERT OR IGNORE INTO jobs(kind,payload,unique_key) VALUES(?,?,?)',kind,JSON.stringify(payload),key)}
 claim(id,uid,cooldown,t=now()){let missingOwner=false;const result=this.tx(()=>{const l=this.one('SELECT * FROM lots WHERE id=?',id);if(!l||l.status!=='free')throw Error('Лот уже занят или недоступен');if(['telegram-market','see-tg'].includes(l.source)&&!JSON.parse(l.data).ownerUsername){this.run("UPDATE lots SET status='stale' WHERE id=? AND status='free'",id);this.enqueue('refresh-public',{id},`refresh-public:${id}:missing-owner`);missingOwner=true;return l}if(!this.active(uid,l.tier,t))throw Error('Нет активного доступа к этому лоту');const u=this.one('SELECT * FROM users WHERE id=?',uid);if(t-u.last_claim<cooldown)throw Error('Подождите окончания кулдауна');this.run("UPDATE lots SET status='claimed',claimed_by=?,claimed_at=? WHERE id=? AND status='free'",uid,t,id);this.run('UPDATE users SET last_claim=? WHERE id=?',t,uid);this.enqueue('hide',{id},`hide:${id}`);this.enqueue('deliver',{id},`deliver:${id}`);return l});if(missingOwner)throw Error('Не могу закрепить лот без подтверждённого @username владельца. Карточка будет обновлена.');return result}
 code(code,tier,seconds,expires,uses){this.run('INSERT INTO codes(hash,tier,seconds,expires,max_uses) VALUES(?,?,?,?,?)',hash(code),tier,seconds,expires,uses)}
 issueLicense(uid,tier,seconds,reference,activeExpires=0){
   const previous=this.one('SELECT * FROM license_keys WHERE reference=?',reference);if(previous)return previous;
   if(!['vip','standard'].includes(tier)||!Number.isSafeInteger(seconds)||seconds<1)throw Error('Некорректный тариф или срок ключа');
   if(!this.one('SELECT 1 FROM users WHERE id=?',uid))throw Error('Пользователь должен сначала нажать /start');
   const key='GT-'+randomUUID();this.run('INSERT INTO license_keys(key,owner_id,tier,seconds,issued_at,activated_at,expires,reference) VALUES(?,?,?,?,?,?,?,?)',key,uid,tier,seconds,now(),activeExpires?now():null,activeExpires,reference);
   return this.one('SELECT * FROM license_keys WHERE key=?',key);
 }
 issueAccess(uid,tier,seconds,reference){return this.tx(()=>{const l=this.issueLicense(uid,tier,seconds,reference);this.enqueue('receipt',{uid,licenseKey:l.key},'license:'+reference);return l})}
 revoke(uid){this.tx(()=>{this.run('UPDATE users SET expires=0 WHERE id=?',uid);this.run('UPDATE license_keys SET revoked=1 WHERE owner_id=?',uid)})}
 redeem(uid,code){return this.tx(()=>{
   const l=this.one('SELECT * FROM license_keys WHERE key=?',code);
   if(l){if(l.owner_id!==uid||l.revoked)throw Error('Ключ недействителен для вашего аккаунта');
     if(l.activated_at!==null){if(l.expires<=now()||!this.active(uid,l.tier))throw Error('Срок ключа истёк или доступ отозван');return l;}
     this.grant(uid,l.tier,l.seconds);const expires=this.one('SELECT expires FROM users WHERE id=?',uid).expires;this.run('UPDATE license_keys SET activated_at=?,expires=? WHERE key=?',now(),expires,code);return this.one('SELECT * FROM license_keys WHERE key=?',code);
   }
   const h=hash(code),c=this.one('SELECT * FROM codes WHERE hash=?',h);if(!c||c.expires<=now()||c.uses>=c.max_uses)throw Error('Код недействителен');if(this.one('SELECT 1 FROM redemptions WHERE hash=? AND user_id=?',h,uid))throw Error('Код уже использован');this.grant(uid,c.tier,c.seconds);this.run('INSERT INTO redemptions VALUES(?,?)',h,uid);this.run('UPDATE codes SET uses=uses+1 WHERE hash=?',h)
 })}
 order(uid,tier,plan){const id=randomUUID();this.run('INSERT INTO orders VALUES(?,?,?,?,?,?,0)',id,uid,tier,plan.stars,plan.seconds,now());return id}
 pay(uid,p){return this.tx(()=>{if(this.one('SELECT 1 FROM payments WHERE charge=?',p.telegram_payment_charge_id))return false;const o=this.validOrder(uid,p);if(p.currency!=='XTR'||!o)throw Error('Некорректный платёж: требуется проверка администратором');const l=this.issueLicense(uid,o.tier,o.seconds,'payment:'+o.id);this.run('INSERT INTO payments VALUES(?,?)',p.telegram_payment_charge_id,o.id);this.run('UPDATE orders SET paid=1 WHERE id=?',o.id);this.enqueue('receipt',{uid,licenseKey:l.key},`receipt:${o.id}`);return true})}
 close(){this.db.close()}
 validOrder(uid,p){return this.one('SELECT * FROM orders WHERE id=? AND user_id=? AND stars=? AND paid=0',p.invoice_payload,uid,p.total_amount)}
}
