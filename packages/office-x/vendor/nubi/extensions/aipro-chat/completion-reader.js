import {httpError} from './core.js';
import {normalizeUsage} from './usage.js';
import {completionStreamError} from './completion-errors.js';

export async function readCompletion(response, onText = () => {}, onUsage = () => {}, onPhase = () => {}, onFinish = () => {}, onTools, onMeasurement = () => {}, onActivity = () => {}, {drainMs = 1000} = {}) {
  if (!response.ok) throw Object.assign(new Error(httpError(response.status)), {status: response.status});
  const toolParts = new Map();
  function validateFinish(reason, hasTools = false) {
    if (reason === 'function_call' || (!onTools && (hasTools || reason === 'tool_calls'))) throw new Error('tools_unavailable');
    if (reason === 'content_filter') throw new Error('response_filtered');
    if (reason && !['stop', 'length', 'tool_calls'].includes(reason)) throw new Error('response_invalid');
  }
  function collectTools(parts) {
    if (!parts) return;
    if (!onTools || !Array.isArray(parts)) throw new Error('tools_unavailable');
    for (const part of parts) {
      const index = part.index ?? toolParts.size;
      if (!Number.isInteger(index) || index < 0 || index >= 8) throw new Error('response_invalid');
      const previous = toolParts.get(index) || {id: '', type: 'function', function: {name: '', arguments: ''}};
      for (const [field, value] of [['id', part.id], ['name', part.function?.name], ['arguments', part.function?.arguments]]) {
        if (value == null) continue;
        if (typeof value !== 'string') throw new Error('response_invalid');
        if (field === 'id') previous.id += value;
        else previous.function[field] += value;
      }
      if (previous.function.arguments.length > 32000 || previous.id.length > 200 || previous.function.name.length > 100) throw new Error('response_invalid');
      toolParts.set(index, previous);
    }
  }
  function finish(content, usage, reason) {
    if (reason === 'length' && toolParts.size) throw Object.assign(new Error('output_limit'), {truncatedTools: true});
    if (toolParts.size || reason === 'tool_calls') {
      const calls = [...toolParts.values()];
      if (reason !== 'tool_calls' || !calls.length || calls.some(call => !call.id || !call.function.name) || new Set(calls.map(call => call.id)).size !== calls.length) throw new Error('response_invalid');
      onTools(calls); onUsage(usage); onFinish(reason); return content;
    }
    if (!content.trim()) throw new Error(reason === 'length' ? 'output_limit' : 'response_invalid');
    onUsage(usage); onFinish(reason || 'stop'); return content;
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    let data;
    try {data = await response.json();} catch (error) {if (error instanceof SyntaxError) throw new Error('response_invalid'); throw error;}
    const reported = normalizeUsage(data?.usage);
    if (reported) onMeasurement(reported);
    if (data?.error) throw completionStreamError(data, response.headers);
    const choice = data?.choices?.[0], content = choice?.message?.content ?? '';
    validateFinish(choice?.finish_reason, !!(choice?.message?.tool_calls?.length || choice?.message?.function_call));
    collectTools(choice?.message?.tool_calls);
    if (typeof content !== 'string') throw new Error(choice?.finish_reason === 'length' ? 'output_limit' : 'response_invalid');
    if (content.length > 400000) throw new Error('too_long');
    onPhase('responding'); onText(content); return finish(content, reported, choice?.finish_reason);
  }
  if (!response.body) throw new Error('response_invalid');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', content = '', complete = false, doneFrame = false, usage = null, finishReason = null, phase = '', finishedAt = null;
  function progress(next) {
    if (phase === 'responding' || phase === next) return;
    phase = next; onPhase(next);
  }
  function frame(block, atEnd = false) {
    if (block.length > 1048576) throw new Error('too_long');
    const event = block.split('\n').findLast(line => line.startsWith('event:'))?.slice(6).trim();
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { complete = true; doneFrame = true; return; }
    let value;
    try {value = JSON.parse(data);} catch {throw new Error(atEnd && !complete ? 'model_stream_incomplete' : 'response_invalid');}
    if (!value || typeof value !== 'object') throw new Error('response_invalid');
    if (value.usage) {const reported = normalizeUsage(value.usage); if (reported) {usage = reported; onMeasurement(reported);}}
    if (event === 'error' || value.error || value.type === 'error') throw completionStreamError(value, response.headers);
    const choice = Array.isArray(value.choices) ? value.choices.find(choice => choice.index === 0) || value.choices[0] : null;
    validateFinish(choice?.finish_reason, !!(choice?.delta?.tool_calls?.length || choice?.delta?.function_call));
    if (choice?.delta?.function_call) throw new Error('tools_unavailable');
    collectTools(choice?.delta?.tool_calls);
    const delta = choice?.delta;
    if ([delta?.content, delta?.reasoning, delta?.reasoning_content].some(value => typeof value === 'string' && value.length) ||
        delta?.tool_calls?.some(part => [part.id, part.function?.name, part.function?.arguments].some(value => typeof value === 'string' && value.length))) onActivity();
    if (choice?.delta?.reasoning || choice?.delta?.reasoning_content) progress('thinking');
    if (typeof choice?.delta?.content === 'string' && choice.delta.content) { content += choice.delta.content; progress('responding'); onText(content); }
    if (content.length > 400000) throw new Error('too_long');
    if (choice?.finish_reason) {complete = true; finishReason = choice.finish_reason; finishedAt ??= performance.now();}
  }
  try {
    while (true) {
      // A finish_reason is terminal. Allow trailing usage, but do not wait
      // forever for a provider/proxy to close its keepalive connection.
      let drainTimer, chunk;
      try {
        if (finishedAt !== null) {
          const remaining = drainMs - (performance.now() - finishedAt);
          if (remaining <= 0) break;
          chunk = await Promise.race([reader.read(), new Promise(resolve => {drainTimer = setTimeout(() => resolve(null), remaining);})]);
          if (!chunk) break;
        } else chunk = await reader.read();
      } finally {clearTimeout(drainTimer);}
      const {done, value} = chunk;
      pending += decoder.decode(value, {stream: !done});
      pending = pending.replace(/\r\n/g, '\n');
      let index;
      while (!doneFrame && (index = pending.indexOf('\n\n')) !== -1) { frame(pending.slice(0, index)); pending = pending.slice(index + 2); }
      if (doneFrame) break;
      if (pending.length > 1048576) throw new Error('too_long');
      if (done) { if (pending.trim()) frame(pending, true); break; }
    }
    if (!complete) throw new Error('model_stream_incomplete');
    return finish(content, usage, finishReason);
  } catch (error) { throw Object.assign(error, {partial: content}); }
  finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
