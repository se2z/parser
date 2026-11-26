/** Admin text can contain login secrets: it is intentionally never persisted, even before a flow starts. */
export function inboxRecord(update,adminIds) {
  if(update.message?.chat.type==='private'&&adminIds.includes(update.message.from?.id)&&!update.message.successful_payment){
    return JSON.stringify({update_id:update.update_id,admin_input_redacted:true,admin_id:update.message.from.id});
  }
  return JSON.stringify(update);
}
