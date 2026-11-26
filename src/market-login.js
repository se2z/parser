import {marketClient} from './market-client.js';
const client=await marketClient();
try {
  const self=await client.start({
    phone:()=>client.input('Номер Telegram в международном формате: '),
    code:()=>client.input('Код из Telegram: '),
    password:()=>client.input('Пароль 2FA (ввод виден в этой консоли): '),
  });
  if(self.isBot)throw Error('Нужен пользовательский аккаунт, не бот');
  console.log('Вход выполнен. Сессия сохранена локально. Можно запускать start-bot.bat.');
} finally {await client.destroy();}
