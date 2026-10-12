// Extracted without behavioral changes from Nubi agent-runtime.js; only wire conversion.
const emptyUsage = () => ({input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}});
const textContent = text => [{type: 'text', text}];
const parseArgs = text => {try {return JSON.parse(text || '{}');} catch {return null;}};
function assistant(content, calls, modelId, stopReason = 'stop') {
  return {role: 'assistant', api: 'openai-completions', provider: 'aipro', model: modelId, timestamp: Date.now(), usage: emptyUsage(), stopReason,
    content: [...(content ? textContent(content) : []), ...(calls || []).map(call => ({type: 'toolCall', id: call.id, name: call.function.name, arguments: parseArgs(call.function.arguments)}))]};
}
export function toPi(messages, modelId) {
  return messages.map(message => {
    if (message.role === 'assistant') return assistant(message.content, message.tool_calls, modelId, message.tool_calls?.length ? 'toolUse' : 'stop');
    if (message.role === 'tool') return {role: 'toolResult', toolCallId: message.tool_call_id, toolName: '', content: textContent(message.content), isError: false, timestamp: Date.now()};
    return {...message, content: Array.isArray(message.content) ? message.content.map(part => {
      if (part.type !== 'image_url') return part;
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(part.image_url?.url || '');
      if (!match) throw new Error('attachment_invalid');
      return {type: 'image', mimeType: match[1], data: match[2]};
    }) : message.content, timestamp: Date.now()};
  });
}
