import {parentPort,workerData} from 'node:worker_threads';
import {Store} from '../src/store.js';
const s=new Store(workerData.path);parentPort.postMessage('ready');parentPort.once('message',()=>{try{s.claim(1,workerData.uid,0);parentPort.postMessage('won')}catch{parentPort.postMessage('lost')}finally{s.close()}});
