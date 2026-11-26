// A display name can impersonate @someone. Require the exact gift in that
// profile's public inventory before treating the name as an owner contact.
export async function ownerFromPublicProfile(lot,request,{initialOffset=''}={}){
 if(lot.ownerUsername||lot.ownerAddress||!lot.slug)return lot;
 const candidate=lot.ownerName?.trim().match(/^@([a-z][a-z0-9_]{3,31})$/i)?.[1];
 if(!candidate)return lot;
 const r=await request({_: 'contacts.resolveUsername',username:candidate});
 const isUser=r.peer?._==='peerUser',isChannel=r.peer?._==='peerChannel';
 if(!isUser&&!isChannel)return lot;
 const id=isUser?r.peer.userId:r.peer.channelId;
 const entity=(isUser?r.users:r.chats)?.find(u=>String(u.id)===String(id));
 if(!entity||entity.accessHash==null||entity.deleted||entity.min)return lot;
 const names=[entity.username,...(entity.usernames||[]).filter(n=>n.active).map(n=>n.username)].filter(Boolean);
 const username=names.find(n=>n.toLowerCase()===candidate.toLowerCase());
 if(!username||lot.ownerId&&String(lot.ownerId)!==String(id))return lot;
 const peer=isUser?{_: 'inputPeerUser',userId:id,accessHash:entity.accessHash}:{_: 'inputPeerChannel',channelId:id,accessHash:entity.accessHash};
 let offset=initialOffset;
 for(let page=0;page<3;page++){
  const inventory=await request({_: 'payments.getSavedStarGifts',peer,excludeUnsaved:true,excludeUnlimited:true,excludeHosted:true,offset,limit:100});
  const found=inventory.gifts?.find(s=>!s.unsaved&&!s.refunded&&s.gift?._==='starGiftUnique'&&s.gift.slug===lot.slug&&(!lot.giftId||String(s.gift.id)===String(lot.giftId)));
  if(found){
   const g=found.gift,ownerId=g.ownerId?.userId??g.ownerId?.channelId;
   // A hosted blockchain gift does not prove ownership of the wallet.
   if(g.ownerAddress||g.hostId||ownerId!=null&&String(ownerId)!==String(id))return lot;
   return {...lot,ownerUsername:username,ownerId:String(id),ownerUsernameSource:'telegram-public-profile-inventory',...(isUser?{premium:!!entity.premium}:{})};
  }
  if(!inventory.nextOffset||inventory.nextOffset===offset)break;
  offset=inventory.nextOffset;
 }
 return lot;
}
