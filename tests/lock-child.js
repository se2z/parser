import {acquireProcessLock} from '../src/process-lock.js';
acquireProcessLock(process.argv[2]);
process.send('locked');
setInterval(()=>{},1000);
