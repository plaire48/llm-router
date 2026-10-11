import {createReceiver} from '../../packages/nubi-a2a/receiver.mjs';
export function browserCollaboration({session,saveSession,conversation,saveChat}){
  return createReceiver({role:'browser',load:async()=>(await session()).a2a||{},save:async value=>saveSession({a2a:value}),busy:async()=>{const s=await session(),{chat}=await conversation(),question=chat?.messages?.at(-1)?.question;return !!(s.chatLease||s.attempt||question&&!question.answer);},
    conversation:async input=>{const {chat}=await conversation();if(input.conversationId!==chat.sessionId)throw new Error('a2a_busy');return {id:chat.sessionId,provider:chat.provider,draft:chat.draft};},
    result:async binding=>{const {chat}=await conversation();if(chat.sessionId!==binding.conversationId||chat.provider!==binding.provider)return null;const reply=chat.messages.find(m=>m.id===binding.runId&&m.role==='assistant');return reply && !reply.error && !['paused','failed','awaiting_user'].includes(chat.task?.requestId===binding.runId ? chat.task.status : '') ?{state:reply.state,text:reply.content,awaitingUser:!!reply.question&&!reply.question.answer}:null;}
  });
}

export {A2A_ERRORS} from '../../packages/nubi-a2a/contract.mjs';
