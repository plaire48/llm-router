// A live dialog is never replayed from storage. Its text and prompt input stay
// in worker/UI memory and are excluded from model receipts and diagnostics.
export function createNativeDialogRequests({changed = async () => {}, timeoutMs = 120000} = {}) {
  let pending;
  const bound = (entry, lease, credential, conversationId) => entry && lease?.id === entry.requestId && !lease.cancelled && lease.conversationId === conversationId && entry.conversationId === conversationId && lease.provider === entry.provider && (credential?.provider || 'aipro') === entry.provider && credential?.receivedAt === entry.credentialReceivedAt && !credential.rejected && (!credential.expiresAt || credential.expiresAt > Date.now());
  return {
    async ask(lease, details, signal) {
      if (pending || signal.aborted || !['confirm','prompt'].includes(details.type) || typeof details.message !== 'string' || details.message.length > 4000) return {accept:false};
      const entry = {...details, id:crypto.randomUUID(), requestId:lease.id, conversationId:lease.conversationId, provider:lease.provider, credentialReceivedAt:lease.credentialReceivedAt, expiresAt:Date.now()+timeoutMs};
      let timer, abort;
      const response = new Promise(resolve => {
        entry.resolve = resolve; pending = entry;
        abort = () => resolve({accept:false});
        signal.addEventListener('abort',abort,{once:true});
        timer = setTimeout(abort,timeoutMs);
      });
      try {await changed(); return await response;}
      finally {clearTimeout(timer);signal.removeEventListener('abort',abort);if(pending===entry)pending=null;await changed().catch(()=>{});}
    },
    view(lease, credential, conversationId) {
      if (!bound(pending,lease,credential,conversationId) || pending.expiresAt <= Date.now() || pending.consumed) return null;
      const {id,type,message,site,requestId,expiresAt} = pending;
      return {id,type,message,site,requestId,expiresAt,conversationId};
    },
    answer(message, lease, credential, conversationId) {
      const entry = pending;
      if (!bound(entry,lease,credential,conversationId) || entry.id !== message.questionId || entry.requestId !== message.requestId || entry.expiresAt <= Date.now() || entry.consumed) throw Error('question_changed');
      const choice = message.choice;
      // The UI sends one alternative. Never interpret conflicting cancel/text
      // payloads as consent, or let an option bypass prompt type/length checks.
      const keys = choice && typeof choice === 'object' && !Array.isArray(choice) ? Object.keys(choice).filter(key => key !== 'questionId') : [];
      if (choice?.questionId !== undefined && choice.questionId !== entry.id) throw Error('question_changed');
      const option = keys.length === 1 && keys[0] === 'optionId' && ['accept','cancel'].includes(choice.optionId);
      const written = keys.length === 1 && keys[0] === 'text' && entry.type === 'prompt' && typeof choice.text === 'string' && choice.text.length <= 4000;
      if (!option && !written) throw Error('tool_arguments_invalid');
      const accept = written || choice.optionId === 'accept';
      entry.consumed = true;
      entry.resolve({accept,promptText:accept && entry.type==='prompt' ? choice.text || '' : undefined});
      return {accepted:true};
    },
  };
}
