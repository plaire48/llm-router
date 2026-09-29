// UI transport fixtures only. Completion-intent decisions and proof requirements
// are independently exercised by completion-review.test/browser.mjs.
export const conversationIntent = JSON.stringify({decision: 'reply', scope: 'conversation', next_step: ''});
export function completionIntentReply(body) {
  const system = body?.messages?.find(message => message.role === 'system')?.content || body?.instructions || body?.systemPrompt || '';
  return typeof system === 'string' && system.startsWith("You are Nubi's completion-intent reviewer.") ? conversationIntent : null;
}
export function completionIntentResponse(body) {
  const content = completionIntentReply(body);
  return content ? {choices: [{message: {role: 'assistant', content}, finish_reason: 'stop'}]} : null;
}
