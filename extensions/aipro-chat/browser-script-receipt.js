// Immutable host interaction facts, never live target authority or approval.
const unknown = reason => ({status: 'unknown', reason});
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const targetKeys = ['tabId','frameId','topDocumentId','documentId','controlId','role','name','tag','type'];
export function normalizeScriptInputTarget(target) {
  if (!target || !Number.isSafeInteger(target.tabId) || target.tabId < 0 || !Number.isSafeInteger(target.frameId) || target.frameId < 0 ||
      !['topDocumentId','documentId','controlId'].every(key => typeof target[key] === 'string' && target[key].length > 0 && target[key].length <= 128) ||
      typeof target.name !== 'string' || target.name.length >= 180 || typeof target.role !== 'string' || target.role.length > 80 ||
      !['input','textarea'].includes(target.tag) || typeof target.type !== 'string' || target.type.length > 32 ||
      !['text','search','email','url','tel','textarea',''].includes(target.type)) return null;
  return Object.fromEntries(targetKeys.map(key => [key,target[key]]));
}
const sameTarget = (a,b) => a && b && targetKeys.every(key => a[key] === b[key]);
export async function createScriptInputWitness({method, value, key, captureTarget, readMatch, cancelled = () => false}) {
  if (method !== 'fill' && (method !== 'press' || key !== 'Enter')) return null;
  // Long/rich-text bodies stay on their existing verification path. No input
  // value or page body is retained here, including on mismatch or failure.
  if (method === 'fill' && (typeof value !== 'string' || value.length > 512)) return null;
  const expectedDigest = method === 'fill' ? await digest(value) : null;
  let target = null, issued = false;
  const capture = async () => {
    try {return cancelled() ? null : normalizeScriptInputTarget(await captureTarget());} catch {return null;}
  };
  return {
    async beforeIssued() {target = await capture();},
    onIssued() {issued = true;},
    async finish(state) {
      const receipt = {dataKind:'script_input_dispatch',version:1,method,actionIssued:issued,
        targetStatus: target && issued ? 'observed' : 'unknown',
        ...(target && issued ? {target} : {reason: issued ? 'target_unknown' : 'not_issued'}),
        ...(method === 'press' && issued ? {key:'Enter'} : {})};
      if (method !== 'fill') return receipt;
      receipt.readback = unknown(!issued ? 'not_issued' : state !== 'returned' ? 'command_failed' : 'readback_unknown');
      if (!issued || state !== 'returned' || !target || cancelled()) return receipt;
      try {
        const before = await capture();
        if (!sameTarget(target,before)) return receipt;
        const first = await readMatch(value);
        const after = await capture();
        if (!sameTarget(target,after) || typeof first !== 'boolean' || cancelled()) return receipt;
        const second = await readMatch(value);
        if (second !== first || !sameTarget(target,await capture()) || cancelled()) return receipt;
        receipt.readback = {status:'observed',matchesExpected:first,expectedDigest};
      } catch { /* Failed observation is unknown, never permission to replay. */ }
      return receipt;
    },
  };
}
const receiptReasons = new Set(['target_unknown','not_issued','command_failed','readback_unknown']);
export function normalizeScriptInputReceipt(receipt, command) {
  if (!receipt || receipt.dataKind !== 'script_input_dispatch' || receipt.version !== 1 || !['fill','press'].includes(receipt.method) ||
      receipt.method !== command.method || typeof receipt.actionIssued !== 'boolean' || receipt.actionIssued !== command.actionIssued ||
      !['observed','unknown'].includes(receipt.targetStatus)) return null;
  const target = receipt.targetStatus === 'observed' && receipt.actionIssued ? normalizeScriptInputTarget(receipt.target) : null;
  const retained = {dataKind:'script_input_dispatch',version:1,method:receipt.method,actionIssued:receipt.actionIssued,
    targetStatus:target?'observed':'unknown',...(target?{target}:{reason:receiptReasons.has(receipt.reason)?receipt.reason:'target_unknown'})};
  if (receipt.method === 'press') {
    if (receipt.key === 'Enter' && receipt.actionIssued) retained.key = 'Enter';
    else if (receipt.actionIssued) return null;
  } else {
    const readback = receipt.readback;
    retained.readback = target && command.state === 'returned' && readback?.status === 'observed' &&
      typeof readback.matchesExpected === 'boolean' && /^[a-f0-9]{64}$/.test(readback.expectedDigest || '')
      ? {status:'observed',matchesExpected:readback.matchesExpected,expectedDigest:readback.expectedDigest}
      : unknown(receiptReasons.has(readback?.reason)?readback.reason:'readback_unknown');
  }
  return retained;
}
