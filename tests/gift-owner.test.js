import test from 'node:test';
import assert from 'node:assert/strict';
import {publicOwnerUsername,enrichGiftOwner} from '../src/gift-owner.js';
import {card,buttons} from '../src/cards.js';
const page=cell=>`<table><tr><th>Owner</th><td>${cell}</td></tr></table>`;
const lot={slug:'MirageLamp-112194',name:'Mirage Lamp',ownerName:'Cherry <Lady>',currency:'XTR',price:475,giftUrl:'https://t.me/nft/MirageLamp-112194'};
test('only a public profile link in the Owner cell supplies a username',()=>{
 assert.equal(publicOwnerUsername(page('<a href="https://t.me/real_seller"><span>Seller</span></a>')),'real_seller');
 assert.equal(publicOwnerUsername(page('<span>@guessed_name</span>')+'<a href="https://t.me/unrelated">Other</a>'),null);
 for(const link of ['https://evil.test/seller','https://t.me/nft/Other-1','https://t.me/share?url=example','https://t.me/login','https://t.me/seller?text=other','https://t.me@evil.test/seller'])assert.equal(publicOwnerUsername(page(`<a href="${link}">Seller</a>`)),null);
});
test('reservation enrichment enables actual profile and offer buttons',async()=>{
 const d=await enrichGiftOwner(lot,{fetchPage:async()=>new Response(page('<a href="https://t.me/real_seller">Seller</a>'),{headers:{'content-type':'text/html'}})});
 assert.equal(d.ownerUsername,'real_seller');assert.match(card(d,true),/@real_seller/);
 assert.equal(buttons(d,1,true).inline_keyboard[1][0].url,'https://t.me/real_seller');
});
test('private name, errors and non-HTML never invent a username or block booking',async()=>{
 for(const fetchPage of [async()=>new Response(page('<span>Cherry Lady</span>'),{headers:{'content-type':'text/html'}}),async()=>{throw Error('timeout')},async()=>new Response('error',{status:429}),async()=>new Response(page('<a href="https://t.me/fake_name">x</a>'))])assert.deepEqual(await enrichGiftOwner(lot,{fetchPage}),lot);
 assert.match(card(lot,true),/Cherry &lt;Lady&gt;/);assert.match(card(lot,true),/Контакт владельца пока не найден/);
});
test('API usernames and wallet ownership are not overridden by webpage guesses',async()=>{
 const fetchPage=()=>{throw Error('must not fetch')};
 const known={...lot,ownerUsername:'api_seller'};assert.equal(await enrichGiftOwner(known,{fetchPage}),known);
 const wallet={...lot,ownerAddress:'wallet'};assert.equal(await enrichGiftOwner(wallet,{fetchPage}),wallet);
 assert.equal(await enrichGiftOwner({...lot,slug:'../other'},{fetchPage}).then(x=>x.ownerUsername),undefined);
});
