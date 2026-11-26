import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerFromPublicProfile} from '../src/owner-profile.js';
const lot={slug:'ExampleGift-12',giftId:'71',ownerName:'@seller_name'};
const user={_:'user',id:42,accessHash:'123',username:'seller_name',premium:true};
const gift={_:'starGiftUnique',slug:lot.slug,id:'71'};
const resolved={peer:{_:'peerUser',userId:42},users:[user]};
test('a username explicitly given in owner name requires the exact public gift as proof',async()=>{
 let count=0;const d=await ownerFromPublicProfile(lot,async r=>{count++;if(r._==='contacts.resolveUsername')return resolved;assert.equal(r.excludeHosted,true);assert.equal(r.peer.userId,42);return{gifts:[{gift}]}});
 assert.equal(count,2);assert.equal(d.ownerUsername,'seller_name');assert.equal(d.ownerId,'42');assert.equal(d.premium,true);
});
test('a name impersonating another account never becomes a seller link',async()=>{
 const d=await ownerFromPublicProfile(lot,async r=>r._==='contacts.resolveUsername'?resolved:{gifts:[{gift:{...gift,slug:'Other-12'}}]});assert.equal(d,lot);
});
test('wallet hosts, a different owner and a different gift id cannot prove ownership',async()=>{
 for(const changed of [{ownerAddress:'wallet'},{hostId:{_:'peerUser',userId:42}},{ownerId:{_:'peerUser',userId:99}},{id:'72'}]){
  assert.equal(await ownerFromPublicProfile(lot,async r=>r._==='contacts.resolveUsername'?resolved:{gifts:[{gift:{...gift,...changed}}]}),lot);
 }
});
test('inventory pagination is bounded and arbitrary display names cause no account searches',async()=>{
 let count=0;assert.equal(await ownerFromPublicProfile(lot,async r=>{count++;return r._==='contacts.resolveUsername'?resolved:{gifts:[],nextOffset:String(count)}}),lot);assert.equal(count,4);
 count=0;const named={...lot,ownerName:'why'};assert.equal(await ownerFromPublicProfile(named,async()=>{count++}),named);assert.equal(count,0);
});
test('a public profile can be confirmed on subsequent inventory pages',async()=>{
 let n=0;const d=await ownerFromPublicProfile(lot,async r=>r._==='contacts.resolveUsername'?resolved:++n===1?{gifts:[],nextOffset:'second'}:{gifts:[{gift}]});assert.equal(d.ownerUsername,'seller_name');assert.equal(n,2);
});
