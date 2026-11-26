import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {acquireProcessLock} from '../src/process-lock.js';

test('legacy empty lock and leftover SQLite file do not prevent startup',()=>{const dir=mkdtempSync(join(tmpdir(),'gift-lock-')),path=join(dir,'tracker.sqlite');try{writeFileSync(path+'.lock','');const first=acquireProcessLock(path);first.release();first.release();const second=acquireProcessLock(path);second.release()}finally{rmSync(dir,{recursive:true,force:true})}});
test('second process rejected while active, restart works after forced termination',async()=>{const dir=mkdtempSync(join(tmpdir(),'gift-crash-')),path=join(dir,'tracker.sqlite');const child=fork(new URL('./lock-child.js',import.meta.url),[path],{stdio:['ignore','ignore','pipe','ipc']});try{await once(child,'message');assert.throws(()=>acquireProcessLock(path),/уже работает/);const ended=once(child,'exit');child.kill('SIGKILL');await ended;const next=acquireProcessLock(path);next.release()}finally{if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill('SIGKILL');await ended}rmSync(dir,{recursive:true,force:true})}});
