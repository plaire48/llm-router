// Project admitted steering into the transcript without promoting it into
// model history. The worker remains the only consumer of the durable inbox.
export function conversationView(chat) {
  const messages = chat.messages || [], consumed = new Set(messages.map(message => message.inputId).filter(Boolean));
  const pending = (chat.inbox || []).filter(item => item.mode === 'steer' && item.conversationId === chat.sessionId && item.provider === chat.provider && !consumed.has(item.id));
  const attached = new Set();
  const inputRow = item => ({key:`input:${item.id}`, message:{role:'user',content:item.text}, index:-1, pendingInput:item});
  const rows = messages.flatMap((message, index) => {
    const inputs = message.role === 'assistant' ? pending.filter(item => item.runId === message.id) : [];
    inputs.forEach(item => attached.add(item.id));
    return [...inputs.map(inputRow), {key:message.inputId ? `input:${message.inputId}` : message.id, message, index,
      separateProgress: message.role === 'assistant' && (!!message.inputGoal || inputs.length > 0)}];
  });
  return [...rows, ...pending.filter(item => !attached.has(item.id)).map(inputRow)];
}
