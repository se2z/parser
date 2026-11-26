import {writeFileSync,renameSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {validateConfig} from './service.js';

export const missingTopics=c=>c.topics.filter(t=>t.enabled!==false&&!t.threadId);
const pendingCreation=c=>c.topics.filter(t=>(t.enabled!==false||t.createAutomatically)&&!t.threadId);
export const topicsReady=c=>c.topics.some(t=>t.enabled!==false)&&missingTopics(c).length===0;
export function saveSettings(app,c){
  validateConfig(c);
  const path=app.env.CONFIG_PATH||'config.json',tmp=path+'.'+randomUUID()+'.tmp';
  try{writeFileSync(tmp,JSON.stringify(c,null,2)+'\n','utf8');renameSync(tmp,path);app.c=c}finally{rmSync(tmp,{force:true})}
}
export class TopicSettings {
  constructor(app,panel){this.app=app;this.panel=panel;this.busy=false}
  async show(uid){
    const c=this.app.c;
    const list=c.topics.map((t,i)=>`${i+1}. ${escTopic(t.name)} — ${t.enabled===false?'выключена':t.threadId||'не настроена'}`).join('\n');
    return this.panel.send(uid,'📂 Темы группы\n\n'+list+'\n\nДля существующей темы нажмите «Указать ID». Либо создайте недостающие темы автоматически. Боту нужно право «Управление темами».',[[{text:'✨ Создать недостающие темы',callback_data:'adm:topicscreate'}],[{text:'✏️ Указать ID / выключить тему',callback_data:'adm:topicsmanual'}]]);
  }
  async create(uid){
    if(this.busy)throw Error('Создание тем уже выполняется.');
    this.busy=true;
    try {
      const app=this.app;
      for(let i=0;i<app.c.topics.length;i++){
        const t=app.c.topics[i];if((t.enabled===false&&!t.createAutomatically)||t.threadId)continue;
        const r=await app.tg.call('createForumTopic',{chat_id:app.chat(t.tier),name:t.name,...(t.iconCustomEmojiId?{icon_custom_emoji_id:t.iconCustomEmojiId}:{})});
        if(!Number.isSafeInteger(r.message_thread_id)||r.message_thread_id<1)throw Error('Telegram не вернул ID созданной темы.');
        const c=structuredClone(app.c);c.topics[i].threadId=r.message_thread_id;saveSettings(app,c);
      }
      if(uid!==undefined)return this.panel.send(uid,'✅ Темы созданы и сохранены. Мониторинг продолжится автоматически, если он включён и аккаунт подключён.');
    }finally{this.busy=false}
  }
  manual(text){
    if(this.busy)throw Error('Дождитесь окончания создания тем.');
    const a=text.trim().split(/\s+/),index=Number(a[0])-1,id=Number(a[1]);
    if(a.length!==2||!Number.isInteger(index)||!this.app.c.topics[index]||!Number.isSafeInteger(id)||id<0)throw Error('Введите номер строки и ID темы, например: 1 123. ID 0 выключает тему.');
    const c=structuredClone(this.app.c),t=c.topics[index];
    if(id>0&&(!t.currency||!Number.isFinite(t.min)||!Number.isFinite(t.max)))throw Error('Для этой темы сначала задайте диапазон цен и валюту в config.json.');
    t.threadId=id;t.enabled=id>0;saveSettings(this.app,c);
  }
}
export async function autoSetupTopics(app,{clock=()=>Date.now(),report=console.log}={}){
  if(!pendingCreation(app.c).length||app.panel.topics.busy||clock()<(app.nextTopicSetup||0))return;
  // Wait before retrying failed attempts; IDs from successful calls have already been saved.
  app.nextTopicSetup=clock()+60000;
  try{
    await app.panel.topics.create();
    app.topicSetupError=null;
    report('Темы группы созданы автоматически. ID сохранены в config.json.');
  }catch(e){
    app.topicSetupError=String(e.message);
    app.nextTopicSetup=clock()+Math.max(60000,(Number(e.retryAfter)||0)*1000);
    report('Не удалось автоматически создать темы: '+e.message+'. Включите темы в группе и выдайте боту право «Управление темами». Повторная попытка — не раньше чем через минуту.');
  }
}
const escTopic=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
