export class Telegram {
 constructor(token){this.token=token}
 async call(method,data={}){let response;try{response=await fetch(`https://api.telegram.org/bot${this.token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(method==='getUpdates'?40000:20000)})}catch(e){const code=e.cause?.code||e.name;throw Error(`Telegram: нет соединения (${/^[A-Za-z0-9_]+$/.test(code)?code:'network error'}). Проверьте VPN и HTTPS_PROXY в .env.`)}
 let j;try{j=await response.json()}catch{throw Error('Telegram: неверный ответ сервера')}
 if(!j.ok){if(method==='answerCallbackQuery'&&j.error_code===400&&/query is too old|response timeout expired|query id is invalid/i.test(j.description))return true;if(j.error_code===400&&/custom.?emoji/i.test(j.description)&&data.text?.includes('<tg-emoji'))return this.call(method,{...data,text:data.text.replace(/<tg-emoji[^>]*>(.*?)<\/tg-emoji>/gs,'$1')});const e=Error(`${method}: ${j.description}`);e.retryAfter=j.parameters?.retry_after;e.code=j.error_code;throw e}return j.result;}
 send(id,text,extra={}){return this.call('sendMessage',{chat_id:id,text,parse_mode:'HTML',link_preview_options:{is_disabled:true},...extra})}
}
