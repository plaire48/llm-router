// Decisions are handled only by a live user response tied to this exact dialog.
// Receipts contain type/disposition, never dialog text or prompt input.
export function watchNativeDialogs(context, {onDecision, canAccept = () => true} = {}) {
  const records = [], waits = new Set(), controllers = new Set();
  // Bounded diagnostic history cannot own the action gate: later alerts may
  // evict a declined or still-pending decision from the visible receipts.
  let closed = false, declined = false, pendingDecisions = 0;
  const blocked = () => declined || pendingDecisions > 0;
  const onDialog = dialog => {
    if (closed) return;
    const type = ['alert','confirm','prompt','beforeunload'].includes(dialog.type()) ? dialog.type() : 'unknown';
    const record = {type,disposition:'unknown'};
    if (type !== 'alert') pendingDecisions++;
    records.push(record);if(records.length>8)records.shift();
    const controller = new AbortController();controllers.add(controller);
    const wait = Promise.resolve().then(async () => {
      let decision;
      if (onDecision && ['confirm','prompt'].includes(type)) {
        // UI-only plain text; never read defaultValue or add message to receipt.
        try {decision = await onDecision({type,message:dialog.message(),site:new URL(dialog.page().url()).origin},controller.signal,dialog.page());}
        catch {decision = null;}
      }
      if (!closed && !controller.signal.aborted && decision?.accept === true && canAccept(dialog.page())) {
        await dialog.accept(type==='prompt' ? decision.promptText || '' : undefined);record.disposition='accepted';
      } else {await dialog.dismiss();record.disposition='dismissed';}
    }).catch(()=>{}).finally(()=>{
      if (type !== 'alert') {pendingDecisions--;if(record.disposition !== 'accepted')declined=true;}
      waits.delete(wait);controllers.delete(controller);
    });
    waits.add(wait);
  };
  context.on('dialog',onDialog);
  return {
    get blocked(){return blocked();},
    assertCanAct(){if(blocked())throw Error('browser_dialog');},
    async waitForDecision(){while(waits.size)await Promise.all([...waits]);},
    snapshot(){return records.map(record=>({...record}));},
    close(){closed=true;context.off('dialog',onDialog);for(const controller of controllers)controller.abort();},
  };
}
