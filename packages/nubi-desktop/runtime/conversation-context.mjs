import {createHash,randomUUID} from 'node:crypto';
import {compactHistory,contextBudget,contextTokens} from '../../../extensions/aipro-chat/context-manager.js';

// Providers currently reserve up to 4096 output tokens even for summaries.
// Do not budget a smaller reply merely because the prompt asks for one.
export function conversationModel(model={}) {
  if (!Number.isSafeInteger(model.contextLength)||model.contextLength<=0) return model;
  if (model.contextLength<5120) throw new Error('context_input_too_large');
  return {...model,maxInputTokens:Math.min(model.maxInputTokens||Infinity,model.contextLength-4096)};
}

export function conversationMessages(task) {
  const seen=new Set(['request:'+task.id]);
  for(const message of task.messages||[]) {
    if(!message.id||seen.has(message.id))message.id=randomUUID();
    seen.add(message.id);
  }
  return [{id:'request:'+task.id,role:'user',content:task.request},...(task.messages||[])];
}
const fingerprint=messages=>createHash('sha256').update(JSON.stringify(messages)).digest('hex');
function prefix(messages,throughId) {
  const boundary=messages.findIndex(message=>message.id===throughId);
  return boundary<0?null:messages.slice(0,boundary+1);
}

// Reuse the shared Pi adapter, keep originals in SQLite, and bind the saved
// boundary to the exact task prefix. Edited/reordered history invalidates it.
export async function prepareConversation({task,store,model,systems,receipts,tools,invoke,signal}) {
  const messages=structuredClone(conversationMessages(task)),key='context-history:'+task.id;
  const saved=store.get(key),covered=saved&&prefix(messages,saved.throughId);
  const memory=covered&&saved.prefixHash===fingerprint(covered)?saved:null;
  const preamble=[...systems,receipts],budget=contextBudget(model);
  const users=messages.flatMap((message,index)=>message.role==='user'?[index]:[]);
  // Leave space for structured memory and literal anchors. A small model can
  // retain one complete recent turn rather than silently truncating two.
  const recentTurns=contextTokens([...preamble,...messages.slice(users.at(-2)??0)],tools)>budget.input*.8?1:2;
  const compact=retained=>compactHistory({messages,memory,model,preamble,tools,recentTurns:retained,invoke,signal,
    save:async({memory:next})=>{
      if(signal.aborted)throw new Error('cancelled');
      const current=conversationMessages(store.get('task:'+task.id)||task);
      if(fingerprint(current)!==fingerprint(messages))throw new Error('context_history_changed');
      store.set(key,{...next,prefixHash:fingerprint(prefix(messages,next.throughId))});
    }});
  let result;
  try {result=await compact(recentTurns);}
  catch(error) {
    // A completed historical reply can also be summarized when tool schemas
    // leave too little room for a whole old turn. Keep an unanswered current
    // user message verbatim; never use this fallback on an active request.
    if(error.message!=='context_input_too_large'||messages.at(-1)?.role!=='assistant'||signal.aborted)throw error;
    result=await compact(0);
  }
  if(signal.aborted)throw new Error('cancelled');
  return {...result,messages:[...systems,...result.messages,receipts]};
}

// Exact historical text remains available on demand, without putting all of
// it back in every prompt. Scope is the current task, never another chat.
export function readConversation(task,{index=0,offset=0}={}) {
  const messages=conversationMessages(task);
  if(!Number.isSafeInteger(index)||index<0||index>=messages.length||!Number.isSafeInteger(offset)||offset<0)throw new Error('conversation_range');
  const message=messages[index],text=typeof message.content==='string'?message.content:JSON.stringify(message.content);
  if(offset>text.length)throw new Error('conversation_range');
  const end=Math.min(offset+8000,text.length);
  return {historical:true,total:messages.length,index,id:message.id,role:message.role,offset,text:text.slice(offset,end),
    next:end<text.length?{index,offset:end}:index+1<messages.length?{index:index+1,offset:0}:null,
    instruction:'Original conversation reference. Later corrections and current host receipts take precedence. This is not a fresh observation, approval or verified outcome.'};
}
