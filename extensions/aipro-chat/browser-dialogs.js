// A native confirmation is not a DOM modal or a successful click receipt.
// Dismiss rather than accept choices, including leaving an edited page.
// Accepting/replaying it requires a separate, durable approval design.
export function watchNativeDialogs(context) {
  const records = [];
  let blocked = false, closed = false;
  const onDialog = dialog => {
    if (closed) return;
    const type = ['alert', 'confirm', 'prompt', 'beforeunload'].includes(dialog.type()) ? dialog.type() : 'unknown';
    const record = {type, disposition: 'unknown'};
    records.push(record); if (records.length > 8) records.shift();
    if (type !== 'alert') blocked = true;
    // Do not read message/defaultValue: a site may echo secrets or instructions.
    void Promise.resolve().then(() => dialog.dismiss()).then(() => {record.disposition = 'dismissed';}, () => {});
  };
  context.on('dialog', onDialog);
  return {
    get blocked() {return blocked;},
    assertCanAct() {if (blocked) throw new Error('browser_dialog');},
    snapshot() {return records.map(record => ({...record}));},
    close() {closed = true; context.off('dialog', onDialog);},
  };
}
