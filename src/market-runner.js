/** Visit every collection, delivering each batch immediately. */
export async function scanMarket(source, ingest, shouldStop=()=>false) {
  source.beginSweep?.();
  let scanned=0,found=0,total=1;
  while(scanned<total&&!shouldStop()) {
    if(Date.now()<(source.blockedUntil||0))return {scanned,total,found,limited:true};
    const lots=await source.poll();
    total=Math.max(1,source.ids?.length||1);
    await ingest(lots);
    found+=lots.length;
    source.commit?.();
    scanned++;
  }
  return {scanned,total,found,limited:false};
}
export function scanInterval(env) {
  const seconds=Number(env.POLL_SECONDS||5);
  if(!Number.isFinite(seconds)||seconds<1)throw Error('POLL_SECONDS должен быть числом от 1');
  return seconds*1000;
}
export async function runMarket({source,ingest,shouldStop,isPaused,intervalMs,report=console.log,onError=console.error}) {
  while(!shouldStop()) {
    const start=Date.now();
    if(!isPaused()) {
      try {
        const result=source.sweep?await source.sweep(ingest,()=>shouldStop()||isPaused()):await scanMarket(source,ingest,()=>shouldStop()||isPaused());
        const duration=Date.now()-start;
        report(`Маркет: обход ${result.scanned}/${result.total} коллекций, найдено ${result.found} лотов, ${(duration/1000).toFixed(1)} сек${result.limited?' — пауза после ошибки или ограничения Telegram':''}${duration>intervalMs?' — целевой интервал превышен':''}`);
      } catch(e) {onError('Источник:',e.message);}
    }
    // Fixed start-to-start target. Never overlap sweeps or accumulate missed runs.
    const until=Math.max(start+intervalMs,Date.now()+250);
    while(!shouldStop()&&Date.now()<until)await new Promise(r=>setTimeout(r,Math.min(250,until-Date.now())));
  }
}
