// Public assistant output only. Never retain reasoning, tool arguments,
// request bodies, headers or authentication from a provider response.
export function evaluationAnswerOutput(body, limit=32000) {
  let message;
  for (const line of String(body).split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const event=JSON.parse(line.slice(5).trim());
      if (['response.completed','response.done'].includes(event.type) && event.response?.status === 'completed') message=event.response;
    } catch {}
  }
  if (!message || !Array.isArray(message.output)) return null;
  const text=message.output.filter(item=>item.type==='message' && item.role==='assistant')
    .flatMap(item=>Array.isArray(item.content)?item.content:[])
    .filter(part=>part.type==='output_text' && typeof part.text==='string').map(part=>part.text).join('\n');
  return {text:text.slice(0,limit),characters:text.length,truncated:text.length>limit};
}
