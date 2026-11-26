import {Store} from './store.js';
import {DemoSource} from './sources.js';
import {card,hidden} from './cards.js';
const s=new Store();s.user({id:1,first_name:'Демо',username:'demo_user'});s.trial(1,'vip',1500);const [lot]=await new DemoSource().poll();
s.run('INSERT INTO lots(source,external_id,data,tier) VALUES(?,?,?,?)',lot.source,lot.externalId,JSON.stringify(lot),'standard');s.claim(1,1,5);
console.log('Публичная карточка:\n'+hidden(s.one('SELECT * FROM users WHERE id=1'))+'\n\nЛичное сообщение:\n'+card(lot,true));console.log(s.all('SELECT kind,done FROM jobs'));s.close();
