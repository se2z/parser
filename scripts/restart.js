import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {acquireProcessLock} from '../src/process-lock.js';

const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='win32')throw Error('Этот батник предназначен для Windows.');
const db=resolve(root,process.env.DB_PATH||'data/tracker.db');
const rel=relative(root,db);
if(rel.startsWith('..')||isAbsolute(rel))throw Error('База вне папки проекта. Остановите этот бот вручную.');
try{
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',readFileSync(new URL('./stop-project-bot.ps1',import.meta.url),'utf8')],{
    cwd:root,stdio:'inherit',env:{...process.env,GIFT_TRACKER_LOCK_TARGET:db+'.process-lock.sqlite'},
  });
  const check=acquireProcessLock(db);
  check.release();
}catch{
  console.error('Прежний процесс всё ещё работает или недоступен для остановки. Новый экземпляр не запущен. Остановите процесс Gift Tracker в диспетчере задач, затем повторите restart-bot.bat.');
  process.exitCode=1;
}
