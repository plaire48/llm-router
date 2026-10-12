import {openaiCodexProvider} from '@earendil-works/pi-ai/providers/openai-codex';
import {stream} from '@earendil-works/pi-ai/api/openai-codex-responses';
import {toPi} from './agent-runtime.js';
import {httpError} from './core.js';
import {observeResponsesUsage} from './usage-stream.js';
import {errorCode, classifyCompletionError} from './completion-errors.js';
import {retryAfterMs} from './http-retry.js';

const models = openaiCodexProvider().getModels();
export function chatGPTModels() {
  // This is Pi's supported catalog, not a claim about this account's access.
  return {status: null, payload: {modelList: models.map((model, index) => ({name: model.id, display_name: model.name,
    sort_seq: index, context_length: model.contextWindow, supports_images: model.input?.includes('image') === true,
    supported_reasoning_levels: ['low','medium','high','xhigh','max'].filter(effort => model.thinkingLevelMap?.[effort] !== null)}))}};
}

export async function completeChatGPT({messages, tools, modelId,modelMetadata, reasoningEffort, credential, signal, onText, onPhase, onActivity = () => {}, onMeasurement = () => {}, onDiagnostic = () => {}, fetchImpl=fetch, maxCharacters = 400000, toolChoice = 'auto', cacheKey}) {
  // Ultra is a display label. Pi's transport accepts the canonical max value.
  const wireEffort = reasoningEffort === 'ultra' ? 'max' : reasoningEffort;
  // Desktop may supply metadata received from this account's catalog. The
  // browser extension keeps its existing static supported-model contract.
  const template=models.find(model=>model.id==='gpt-5.6-sol')||models[0];
  const discovered=modelMetadata?.id===modelId&&/^[a-zA-Z0-9._-]{1,160}$/.test(modelId)&&Number.isSafeInteger(modelMetadata.contextLength)&&modelMetadata.contextLength>0;
  const model = discovered?{...(models.find(model=>model.id===modelId)||template),id:modelId,name:modelMetadata.label||modelId,contextWindow:modelMetadata.contextLength}:models.find(model => model.id === modelId);
  if (!model) throw new Error('invalid_model');
  const context = {messages: [{role: 'system', timestamp: 0,
    content: messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n'), toolsAdded: tools.map(tool => tool.function)},
    ...toPi(messages.filter(message => message.role !== 'system'), modelId).map(message => message.role === 'assistant' ? {...message, api: model.api, provider: model.provider} : message)]};
  let transportError;let status = 0, retryDelay, content = '', output, measuredUsage = null, overflow = false, streaming = false, terminal = false, streamFailure, rejectionCode, rejection, rejectedParameter;
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener('abort', abort, {once: true});
  try {
    // One cache key per conversation and kind of call, sent as prompt_cache_key
    // (as Codex CLI does), so requests that share their beginning reach the same
    // cache. It is a hash; the conversation id itself is not sent.
    const response = stream(model, context, {apiKey: credential.token, signal: controller.signal, transport: 'sse', maxRetries: 0, toolChoice, ...(cacheKey ? {sessionId: cacheKey} : {}),
      fetch: async (url, options) => {
        let response;try{response=await fetchImpl(url,{...options,credentials:'omit',redirect:'error',cache:'no-store'});}catch(error){transportError=error;throw error;}
        status = response.status; retryDelay = retryAfterMs(response.headers);
        streaming = response.ok && response.headers.get('content-type')?.includes('text/event-stream');
        if (!response.ok) {
          const body = await response.clone().json().catch(() => null);
          const error = body?.error && typeof body.error === 'object' ? body.error : body;
          rejectionCode = errorCode(error?.code) || errorCode(error?.type);
          rejection = classifyCompletionError(response.status, body);
          rejectedParameter = ['reasoning.effort', 'reasoning.summary', 'reasoning', 'model', 'tools', 'input', 'include', 'store'].includes(error?.param) ? error.param : undefined;
          overflow = response.status === 413 || ['context_length_exceeded', 'context_window_exceeded', 'max_input_tokens'].includes(error?.code);
        }
        return observeResponsesUsage(response, usage => {measuredUsage = usage; onMeasurement(usage);}, () => {terminal = true;}, error => {streamFailure = error;});
      },
      // Pi defaults summary to auto even when its option is omitted. Omit the
      // optional wire field through its public hook: "off" is not an API value,
      // and this client does not retain or display reasoning summaries.
      onPayload: payload => {
        // Account-reported levels are authoritative. A discovered model may
        // inherit a bundled template whose minimal/off aliases differ.
        const accountEffort = discovered && modelMetadata.reasoningOptions?.includes(wireEffort);
        if (!accountEffort && (!payload?.reasoning || typeof payload.reasoning !== 'object')) return payload;
        const reasoning = {...payload.reasoning, ...(accountEffort ? {effort:wireEffort} : {})};
        delete reasoning.summary;
        return {...payload, reasoning};
      },
      ...(wireEffort ? {reasoningEffort: wireEffort} : {}), onResponse: response => {status = response.status;}});
    for await (const event of response) {
      if (['text_delta', 'thinking_delta', 'toolcall_delta'].includes(event.type) && typeof event.delta === 'string' && event.delta) onActivity();
      if (signal.aborted) throw new Error('cancelled');
      if (event.type === 'text_delta') {
        content += event.delta;
        if (content.length > maxCharacters) throw new Error('too_long');
        onPhase('responding'); onText(content);
      } else if (event.type === 'thinking_start') onPhase('thinking');
      else if (event.type === 'done') output = event.message;
      else if (event.type === 'error') throw new Error(overflow ? 'context_overflow' : status >= 400 ? rejection?.error || httpError(status) : status ? 'response_invalid' : 'chatgpt_network');
    }
    if (streamFailure) throw streamFailure;
    if (!output || ['pending', 'error', 'aborted'].includes(output.stopReason)) throw new Error('response_invalid');
    content = output.content.filter(part => part.type === 'text').map(part => part.text).join('');
    if (content.length > maxCharacters) throw new Error('too_long');
    onText(content);
    if (output.stopReason === 'length' && output.content.some(part => part.type === 'toolCall')) throw Object.assign(new Error('output_limit'), {truncatedTools: true});
    // Replay call IDs only: response item IDs refer to encrypted reasoning that
    // this extension deliberately does not retain in the conversation.
    const calls = output.content.filter(part => part.type === 'toolCall').map(part => ({id: part.id.split('|')[0], type: 'function', function: {name: part.name, arguments: JSON.stringify(part.arguments)}}));
    if (calls.length > 8 || calls.some(call => !call.id || call.id.length > 256 || call.function.arguments.length > 32000) || new Set(calls.map(call => call.id)).size !== calls.length) throw new Error('response_invalid');
    if (!content.trim() && !calls.length) throw new Error(output.stopReason === 'length' ? 'output_limit' : 'response_invalid');
    return {content, calls, finishReason: calls.length ? 'tool_calls' : output.stopReason === 'length' ? 'length' : 'stop',
      usage: measuredUsage};
  } catch (error) {
    // Never surface SDK diagnostics, response bodies or authentication headers.
    const allowed = ['context_overflow', 'cancelled', 'too_long', 'response_invalid', 'output_limit', 'chatgpt_network', 'unauthorized', 'forbidden', 'rate_limited', 'invalid_model', 'upstream', 'request_rejected', 'request_format', 'request_image', 'request_endpoint'];
    const code = transportError?'chatgpt_network':streamFailure?.message || (streaming && !terminal && ['response_invalid', 'chatgpt_network'].includes(error.message) ? 'model_stream_incomplete' : allowed.includes(error.message) ? error.message : 'response_invalid');
    // Settings > connection diagnostics shows why the server failed: its status
    // and error code, never its message text or the request. It never changes the outcome.
    if (!signal.aborted && (status >= 400 || streamFailure)) {
      const diagnostic = {phase: 'rejected', attempt: 1, status: status || 200, code: streamFailure ? streamFailure.code : rejectionCode,
        reason: streamFailure ? 'stream_error' : overflow ? 'context_limit' : rejection?.reason || 'http',
        ...(rejectedParameter ? {parameter: rejectedParameter} : {}),
        ...(['none','minimal','low','medium','high','xhigh','max'].includes(wireEffort) ? {reasoningEffort: wireEffort} : {})};
      try { onDiagnostic(diagnostic); } catch { /* Diagnostics never change the request outcome. */ }
    }
    throw Object.assign(new Error(signal.aborted ? 'cancelled' : code), {status, retryAfterMs: retryDelay, partial: content,...(transportError?{cause:transportError}:{}),
      ...(streamFailure ? {retryable: streamFailure.retryable} : {}), ...(error.truncatedTools ? {truncatedTools: true} : {})});
  } finally {abort(); signal.removeEventListener('abort', abort);}
}
