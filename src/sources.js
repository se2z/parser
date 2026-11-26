// Adapter contract: poll() => Promise<Array<normalized lot>>. No fabricated marketplace API.
export class DemoSource {
 async poll(){const n=Math.floor(Date.now()/120000);return [{source:'demo',externalId:String(n),demo:true,name:'Pool Float (DEMO)',number:n,model:'Air Bunny',price:555,currency:'XTR',messageCost:'Free',premium:false}];}
}
export function validate(d){if(!d||typeof d.source!=='string'||typeof d.externalId!=='string'||!d.name||!Number.isFinite(d.price)||d.price<0||!['XTR','TON'].includes(d.currency))throw Error('Некорректный лот адаптера');for(const key of ['giftUrl','imageUrl','offerUrl'])if(d[key]&&new URL(d[key]).protocol!=='https:')throw Error('Разрешены только HTTPS ссылки');if(d.ownerUsername&&!/^[a-zA-Z0-9_]{1,32}$/.test(d.ownerUsername))throw Error('Некорректный username');return d}
