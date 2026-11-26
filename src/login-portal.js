import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';

export class LoginPortal {
  constructor(accounts,admins,{port=8765}={}){Object.assign(this,{accounts,admins,port});this.tokens=new Map()}
  async start(){
    this.server=createServer((req,res)=>this.handle(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'Ошибка входа. Откройте подключение заново из админ-панели.'}));}));
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.port,'127.0.0.1',resolve)});
    this.port=this.server.address().port;return this;
  }
  async open(uid){
    if(!this.admins.includes(uid))throw Error('Нет прав администратора.');
    await this.accounts.begin(uid);
    for(const [key,value] of this.tokens)if(value.uid===uid||value.expires<Date.now())this.tokens.delete(key);
    const token=randomBytes(32).toString('hex');this.tokens.set(token,{uid,expires:Date.now()+300000});
    return `http://127.0.0.1:${this.port}/#${token}`;
  }
  async handle(req,res){
    const host=`127.0.0.1:${this.port}`;
    res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');
    res.setHeader('x-content-type-options','nosniff');res.setHeader('x-frame-options','DENY');
    if(req.headers.host!==host){res.writeHead(403);return res.end()}
    if(req.method==='GET'&&req.url==='/'){
      res.setHeader('content-type','text/html; charset=utf-8');
      res.setHeader('content-security-policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
      return res.end(readFileSync(new URL('./login.html',import.meta.url)));
    }
    const token=req.headers.authorization?.replace(/^Bearer /,''),record=this.tokens.get(token);
    if(!record||record.expires<Date.now()||!this.admins.includes(record.uid)){res.writeHead(401);return res.end(JSON.stringify({error:'Ссылка истекла. Откройте подключение из админ-панели.'}))}
    if(req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403);return res.end()}
    res.setHeader('content-type','application/json; charset=utf-8');
    if(req.method==='POST'&&req.url==='/input'){
      if(req.headers['content-type']!=='application/json'){res.writeHead(415);return res.end('{}')}
      let body='';for await(const part of req){body+=part;if(body.length>4096){res.writeHead(413);return res.end('{}')}}
      let value;try{value=JSON.parse(body).value}catch{res.writeHead(400);return res.end('{}')}
      if(typeof value!=='string'||value.length>1024){res.writeHead(400);return res.end('{}')}
      try{const message=await this.accounts.input(record.uid,value);const stage=this.accounts.owns(record.uid)?this.accounts.flow.stage:'done';if(stage==='done')this.tokens.delete(token);return res.end(JSON.stringify({message,stage}))}catch(e){res.writeHead(400);return res.end(JSON.stringify({error:e.message}))}
    }
    if(req.method==='POST'&&req.url==='/cancel'){await this.accounts.cancel(record.uid);this.tokens.delete(token);return res.end('{}')}
    res.writeHead(404);res.end('{}');
  }
  async close(){this.tokens.clear();if(this.server){this.server.closeAllConnections();await new Promise(resolve=>this.server.close(resolve))}}
}
