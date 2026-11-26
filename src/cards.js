export const esc=s=>String(s??'Нет данных').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const kb=rows=>({inline_keyboard:rows});
export const cb=(text,data)=>({text,callback_data:data});
export const url=(text,link)=>({text,url:link});
export const owner=d=>d.ownerUsername?`https://t.me/${d.ownerUsername}`:null;
export const userLink=u=>`<a href="tg://user?id=${u.id}">${esc(u.username?'@'+u.username:u.name)}</a>`;
export const referenceEmoji={listing:'5305533376596326292',gift:'5323586180703364568',price:'5409321884074419506',star:'5411211025439548989',owner:'5408916348967348391',model:'5294508856972447548',level:'5411180428092533606',message:'5409143419593321597',status:'5305357952952084200'};
const icon=(name,fallback)=>`<tg-emoji emoji-id="${referenceEmoji[name]}">${fallback}</tg-emoji>`;
const previewLink=d=>d.giftUrl?`<a href="${esc(d.giftUrl)}">\u200b</a>`:'';
const amount=d=>esc(d.priceText??d.price)+(d.currency==='XTR'?' '+icon('star','⭐'):' TON')+(d.ton!=null&&d.currency!=='TON'?` / ${d.tonKind==='listed'?'':'≈ '}${esc(d.tonPriceText??d.ton)} TON`:'');
export function offer(d){
 if(d.offerUrl)return {url:d.offerUrl,text:d.offerText||d.giftUrl||d.name};
 if(!d.ownerUsername||!d.giftUrl||d.currency!=='XTR')return null;
 const discounted=Math.round(d.price*0.98);
 const text=`/start ${d.giftUrl} ${discounted} stars ru 2`;
 return {text,url:`${owner(d)}?text=${encodeURIComponent(text)}`};
}
export function card(d,personal=false){
 const prefix=(d.demo?'🧪 ДЕМО — тестовые данные\n\n':'')+previewLink(d);
 if(personal){const username=d.ownerUsername?`<a href="${esc(owner(d))}">@${esc(d.ownerUsername)}</a>`:d.ownerName?`${esc(d.ownerName)}\nКонтакт владельца пока не найден`:'Контакт владельца пока не найден';
  return `${prefix}🔔 Thanks for buying!\n\n🎁 Gift: ${esc(d.name)}\n⭐ Price: ${esc(d.priceText??d.price)} ${d.currency==='XTR'?'⭐':'TON'}${d.ton!=null&&d.currency!=='TON'?` / ${d.tonKind==='listed'?'':'≈ '}${esc(d.tonPriceText??d.ton)} TON`:''}\n🤝 Model: ${esc(d.model)}\n💬 Message: ${d.messageCost===0?'Free':esc(d.messageCost)}\n⚡ Status: ${d.premium==null?'Нет данных':d.premium?'Premium ✅':'Premium ❌'}\n\n👤 ${username}\n\n<i>Лот закреплён в сервисе. Для сделки свяжитесь с продавцом.</i>`;
 }
 return `${prefix}${d.initialSnapshot?'🟠 ТЕКУЩИЙ ЛОТ':icon('listing','🔥')+' НОВЫЙ ЛИСТИНГ'}\n\n${icon('gift','🎁')} <b>Подарок:</b> <i>Скрыто</i>\n${icon('price','💎')} <b>Цена:</b> ${amount(d)}\n${icon('owner','👤')} <b>Владелец:</b> <i>Скрыто</i>\n${icon('model','💎')} <b>Модель:</b> ${esc(d.model)}\n${icon('level','🔨')} <b>Уровень:</b> ${esc(d.level)}\n${icon('message','✈️')} <b>Сообщение:</b> ${d.messageCost===0||d.messageCost==='Free'?'Бесплатно':esc(d.messageCost)}\n${icon('status','⚡️')} <b>Статус:</b> ${d.premium==null?'Нет данных':d.premium?'Премиум':'Без премиума'}`;
}
export function buttons(d,id,personal=false){
 if(!personal)return kb([[{...cb('📣 Занять лот',`claim:${id}`),style:'danger'}]]);
 const rows=[],o=offer(d);if(o)rows.push([url('💸 Оффер (-2%) ↗',o.url)]);
 const r=[];if(owner(d))r.push(url('Открыть профиль ↗',owner(d)));
 r.push({text:'📋 Скопировать',copy_text:{text:(o?.text||[d.name+' #'+d.number,d.ownerUsername?'@'+d.ownerUsername:'',d.giftUrl||''].filter(Boolean).join('\n')).slice(0,256)}});rows.push(r);return kb(rows);
}
export function hidden(u){return `${icon('listing','🔥')} НОВЫЙ ЛИСТИНГ\n\n${icon('gift','🎁')} <b>Подарок:</b> <i>Скрыто</i>\n${icon('price','💎')} <b>Цена:</b> <i>Скрыто</i>\n${icon('owner','👤')} <b>Владелец:</b> <i>Скрыто</i>\n🔒 <b>Лот занял:</b> ${userLink(u)}`}
export const occupiedButton=u=>({...cb(`🔒 Занято (${u.username?'@'+u.username:u.name})`.slice(0,60),'occupied'),style:'danger'});
