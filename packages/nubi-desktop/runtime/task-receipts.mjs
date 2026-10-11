export const TASK_RECEIPT_LIMIT=20;
const unresolved=item=>['proposed','starting','running','stopping','checking','attention','interrupted'].includes(item.state)||item.execution==='unknown';

// UI history is bounded across all tasks. Agent evidence is bounded only after
// task isolation, prioritizes unresolved records, and declares every omission.
export function taskReceiptRecords(store,taskId){
  const result={},inventory={complete:true,omitted:{}};
  for(const [field,prefix] of [['proposals','proposal:'],['setupActions','setup-action:'],['processes','process:']]){
    const owned=store.list(prefix).filter(item=>item.taskId===taskId);
    const ordered=[...owned.filter(unresolved),...owned.filter(item=>!unresolved(item))];
    result[field]=ordered.slice(0,TASK_RECEIPT_LIMIT);
    inventory.omitted[field]=Math.max(0,ordered.length-result[field].length);
    if(inventory.omitted[field])inventory.complete=false;
  }
  return {...result,inventory};
}
