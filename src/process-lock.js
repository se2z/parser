import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

/** SQLite uses OS file locks, released automatically on process death. Never unlink this file. */
export function acquireProcessLock(dbPath){
  const path=resolve(dbPath)+'.process-lock.sqlite';
  mkdirSync(dirname(path),{recursive:true});
  let db;
  try{
    db=new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
  }catch(e){
    try{db?.close()}catch{}
    if(e.errcode===5||e.errcode===6||/database is (?:locked|busy)/i.test(e.message)) {
      throw Error('Этот бот уже работает. Закройте его предыдущее окно перед повторным запуском.');
    }
    throw Error('Не удалось открыть блокировку процесса: '+e.message);
  }
  let released=false;
  return {release(){if(!released){db.close();released=true}}};
}
