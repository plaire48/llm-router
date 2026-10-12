import {normalizeResponsesUsage} from './usage.js';
import {completionStreamError} from './completion-errors.js';

// Observe counters on the same stream the SDK consumes. This keeps absent
// upstream usage distinct from the SDK's default zero-valued usage object.
export function observeResponsesUsage(response, onUsage, onTerminal = () => {}, onFailure = () => {}) {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response;
  const decoder = new TextDecoder();
  let pending = '', dropping = false;
  function read(value, done = false) {
    pending += decoder.decode(value, {stream: !done});
    pending = pending.replace(/\r\n/g, '\n');
    let boundary;
    while ((boundary = pending.indexOf('\n\n')) >= 0) {
      const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
      if (dropping || block.length > 4194304) {dropping = false; continue;}
      try {
        const raw = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        const event = JSON.parse(raw);
        if (['response.done', 'response.completed', 'response.incomplete', 'response.failed', 'error'].includes(event.type)) {
          onTerminal(event.type);
          if (['response.failed', 'error'].includes(event.type)) onFailure(completionStreamError(event, response.headers));
          const usage = normalizeResponsesUsage(event.response?.usage);
          if (usage) onUsage(usage);
        }
      } catch { /* Metrics must never interrupt a response. */ }
    }
    if (pending.length > 4194304) {pending = ''; dropping = true;}
  }
  const body = response.body.pipeThrough(new TransformStream({transform(chunk, controller) {controller.enqueue(chunk); read(chunk);}, flush() {read(undefined, true); if (pending.trim()) read(new TextEncoder().encode('\n\n'));}}));
  return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
}
