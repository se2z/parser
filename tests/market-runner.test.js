import test from 'node:test';
import assert from 'node:assert/strict';
import {scanMarket,scanInterval,runMarket} from '../src/market-runner.js';
test('sweep visits all collections and ingests each before proceeding',async()=>{
  let index=0;const visited=[],delivered=[];
  const source={ids:[],beginSweep(){},async poll(){this.ids=['a','b','c'];visited.push(this.ids[index]);return [this.ids[index]]},commit(){index++}};
  const result=await scanMarket(source,async lots=>{delivered.push(...lots);assert.equal(visited.length,delivered.length)});
  assert.deepEqual(visited,['a','b','c']);assert.deepEqual(delivered,visited);assert.equal(result.scanned,3);assert.equal(result.found,3);
});
test('failed ingestion does not commit or continue',async()=>{
  let committed=0;const source={ids:['a','b'],poll:async()=>['lot'],commit(){committed++}};
  await assert.rejects(()=>scanMarket(source,async()=>{throw Error('db')}),/db/);assert.equal(committed,0);
});
test('Telegram pause stops sweep without more requests',async()=>{
  let calls=0;const source={ids:['a','b'],blockedUntil:Date.now()+10000,poll(){calls++}};
  const result=await scanMarket(source,async()=>{});assert.equal(calls,0);assert.equal(result.limited,true);
});
test('default interval is 5 seconds; invalid setting rejected',()=>{
  assert.equal(scanInterval({}),5000);assert.equal(scanInterval({POLL_SECONDS:'5'}),5000);assert.throws(()=>scanInterval({POLL_SECONDS:'bad'}));
});
test('slow sweeps never overlap and report target overrun',async()=>{
  let calls=0,stop=false;const source={ids:['a','b'],async poll(){calls++;await new Promise(r=>setTimeout(r,5));return []},commit(){}};
  await runMarket({source,ingest:async()=>{},shouldStop:()=>stop,isPaused:()=>false,intervalMs:1,report(text){assert.ok(text.includes('интервал превышен'));stop=true}});
  assert.equal(calls,2);
});
