import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export async function marketClient(env=process.env) {
  const apiId=Number(env.TELEGRAM_API_ID);
  if(!Number.isInteger(apiId)||apiId<=0||!env.TELEGRAM_API_HASH) {
    throw Error('Для маркета нужны TELEGRAM_API_ID и TELEGRAM_API_HASH из my.telegram.org');
  }
  const {TelegramClient,proxyTransportFromUrl}=await import('@mtcute/node');
  const storage=env.TELEGRAM_SESSION_PATH||'data/market.session';
  mkdirSync(dirname(storage),{recursive:true});
  let transport;
  try{if(env.TELEGRAM_PROXY_URL)transport=proxyTransportFromUrl(env.TELEGRAM_PROXY_URL)}catch{throw Error('Некорректный TELEGRAM_PROXY_URL')}
  return new TelegramClient({apiId,apiHash:env.TELEGRAM_API_HASH,storage,updates:false,logLevel:0,...(transport?{transport}:{})});
}
