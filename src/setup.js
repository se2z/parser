import {Telegram} from './telegram.js';
if(!process.env.BOT_TOKEN)throw Error('Укажите BOT_TOKEN в .env');
const tg=new Telegram(process.env.BOT_TOKEN);
console.log('Остановите основной бот. Напишите /ids в каждой теме и в личных сообщениях. Ctrl+C — выход.');
let offset=0;
while(true){const updates=await tg.call('getUpdates',{offset,timeout:20,allowed_updates:['message']});for(const u of updates){offset=u.update_id+1;const m=u.message;if(m?.text?.split('@')[0]==='/ids')console.log(JSON.stringify({chat_id:m.chat.id,thread_id:m.message_thread_id||null,user_id:m.from.id,title:m.chat.title||'private'}));}}
