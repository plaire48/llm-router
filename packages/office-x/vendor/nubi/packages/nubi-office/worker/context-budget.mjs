import {compactMessages} from './model-context.mjs';

// Budgets follow the context window of the selected model. Every model Nubi Office is used with reads 256K to 512K
// tokens (user, 2026-09-30), so a model whose catalog reports no window is taken as 256K. Counts are the upper-bound
// estimate below until the model server has reported the tokens of a request (measured tokens, below). Count the
// complete message + tool schema envelope, not just a body.
export const DEFAULT_CONTEXT_TOKENS=256000;
// Kept free for the model's answer. The provider asks for the same number (providers.mjs).
export const OUTPUT_TOKENS=16384;
// A transport bound only. The token budget of the model decides first.
export const REQUEST_CHAR_LIMIT=3000000;
export const requestChars=(messages,tools=[])=>JSON.stringify({messages,tools}).length;
// An upper bound, not a token count. Against a real tokenizer (o200k, not the Qwen tokenizer) it never came out
// below the actual count on 216 recorded requests and on Korean conversation text; the median was 1.3 times higher.
export function estimateTokens(text){let ascii=0,other=0;for(const character of String(text??''))if(character.charCodeAt(0)<128)ascii++;else other++;return Math.ceil(ascii/3+other);}
const positive=value=>Number.isSafeInteger(value)&&value>0;
// Measured tokens (user, 2026-09-30): the model server reports the tokens of every request it answers. AI Pro and vLLM
// send usage.prompt_tokens in the last stream chunk; ChatGPT reports input_tokens. The ratio of that count to the
// estimate of the same request scales the budget of that model, so clearing, renewal and the request limit follow the
// tokens the model counted, not an upper bound (the estimate ran about 1.3 times high on Korean text). Until the first
// report the estimate decides. The largest of the last eight ratios is used, with 5% to spare, so one low count never
// loosens the budget alone; a request the server refuses as too long forgets the measurements of that model.
const measurements=new Map();
const modelKey=model=>typeof model?.id==='string'&&model.id?model.id:null;
export function tokenFactor(model){const entry=measurements.get(modelKey(model));return entry?.ratios.length?Math.min(2,Math.max(0.25,Math.max(...entry.ratios)*1.05)):1;}
export function recordPromptTokens(model,estimated,promptTokens){
  const key=modelKey(model);if(!key||!positive(estimated)||!positive(promptTokens))return null;
  const ratio=promptTokens/estimated;if(!(ratio>=0.05&&ratio<=5))return null;
  const entry=measurements.get(key)??{ratios:[]};entry.ratios=[...entry.ratios,ratio].slice(-8);entry.promptTokens=promptTokens;entry.estimatedTokens=estimated;
  measurements.set(key,entry);return tokenFactor(model);
}
export function forgetPromptTokens(model){const key=modelKey(model);if(key)measurements.delete(key);}
// The model's input limit in tokens: the catalog's input limit, else its window less the answer reserve.
export function modelInputTokens(model){
  const source=positive(model?.maxInputTokens)?'maxInputTokens':positive(model?.contextLength)?'contextLength':'default';
  return source==='maxInputTokens'?model.maxInputTokens:(source==='contextLength'?model.contextLength:DEFAULT_CONTEXT_TOKENS)-OUTPUT_TOKENS;
}
// Compaction follows the window of the selected model as its catalog reports it (AI Pro: context_length, or context in
// its open_api entries; user, 2026-09-30), with the rule of the browser runtime (extensions/aipro-chat/context-manager.js,
// contextBudget): the executor context is renewed at 90% of the input limit, at 75% under a 128K window, where one large
// read is a big share of it. Anthropic compacts a 1M window near 900K the same way. A fixed 160K cap rested on an
// estimate of gateway time-outs, not a measured failure; a request the server could not answer now lowers that model's
// point itself (pressure, below). Older tool results are cleared from 75% of that point; renewal keeps the recent
// exchanges and a progress log. No request above 90% of the input limit is sent. The values are the model's tokens.
const pressureLimits=new Map();
export function modelBudget(model){
  const input=modelInputTokens(model),window=positive(model?.contextLength)?model.contextLength:DEFAULT_CONTEXT_TOKENS,pressure=pressureLimits.get(modelKey(model));
  const compact=Math.min(Math.floor(input*(window>=128000?0.9:0.75)),pressure??Infinity);
  return{input,limit:Math.floor(input*0.9),compact,clear:Math.floor(compact*0.75),...(pressure?{pressure}:{})};
}
// A large request (at least min(100K, half the input limit) tokens) that the server could not answer, a time-out or a
// 5xx, sets that model's compaction point to 80% of its tokens, kept while the worker lives (browser: pressureLimits).
export const largeInputTokens=model=>Math.min(100000,Math.floor(modelInputTokens(model)*0.5));
export function recordPressure(model,modelTokens){
  const key=modelKey(model);if(!key||!positive(modelTokens)||modelTokens<largeInputTokens(model))return null;
  const limit=Math.min(pressureLimits.get(key)??Infinity,Math.floor(modelTokens*0.8));pressureLimits.set(key,limit);return limit;
}
export function forgetPressure(model){const key=modelKey(model);if(key)pressureLimits.delete(key);}
// The same limits in units of the estimate: divided by the measured factor, an estimate compared with them stands for the
// tokens the model counts.
export function requestBudget(model){
  const source=positive(model?.maxInputTokens)?'maxInputTokens':positive(model?.contextLength)?'contextLength':'default';
  const {limit,compact,clear}=modelBudget(model),factor=tokenFactor(model),scale=value=>Math.floor(value/factor),limitTokens=scale(limit);
  return limitTokens>0?{source,limitTokens,checkpointTokens:scale(compact),clearTokens:scale(clear),...(factor!==1?{measured:{factor,limitModelTokens:limit}}:{})}:null;
}
export const selectedModel=providers=>{try{const status=providers?.status?.();return status?.models?.find?.(model=>model.id===status.model)??null;}catch{return null;}};
// Decide from the same lossless representation used for dispatch. Repeated
// Office formats can be large on disk but tiny on the wire. This preflight
// deliberately has no request metrics: only actual dispatch records usage.
export function needsContextCheckpoint(messages,tools=[],model){
  if(!messages.some(m=>m.role==='tool'))return false;
  const budget=requestBudget(model);return!!budget&&estimateTokens(JSON.stringify({messages:compactMessages(messages),tools}))>budget.checkpointTokens;
}
// limit (characters) is for measurement only: it lowers the size at which older results are cleared.
export function needsClearing(messages,tools=[],model,limit){
  if(!messages.some(m=>m.role==='tool'))return false;
  const compact=compactMessages(messages);if(limit!==undefined)return requestChars(compact,tools)>limit;
  const budget=requestBudget(model);return!!budget&&estimateTokens(JSON.stringify({messages:compact,tools}))>budget.clearTokens;
}
export function prepareContextRequest(messages,tools=[],metrics={},model) {
  const compact=compactMessages(messages,metrics),wire=JSON.stringify({messages:compact,tools}),chars=wire.length,budget=requestBudget(model);
  const state=metrics.requestContext??={requests:0,peakChars:0,peakUtf8Bytes:0,rejected:0,limitChars:REQUEST_CHAR_LIMIT,tokenCount:'unmeasured'};
  state.requests++;state.peakChars=Math.max(state.peakChars,chars);state.peakUtf8Bytes=Math.max(state.peakUtf8Bytes,Buffer.byteLength(wire));
  if(chars>REQUEST_CHAR_LIMIT){state.rejected++;throw new Error('context_overflow');}
  const estimated=estimateTokens(wire);state.lastEstimatedTokens=estimated;
  if(budget){
    const tokens=modelBudget(model);if(state.tokenCount!=='measured')state.tokenCount='estimated';
    Object.assign(state,{limitTokens:budget.limitTokens,limitSource:budget.source,modelId:modelKey(model),modelInputTokens:tokens.input,clearModelTokens:tokens.clear,compactModelTokens:tokens.compact,peakEstimatedTokens:Math.max(state.peakEstimatedTokens||0,estimated)});
    if(estimated>budget.limitTokens){state.rejected++;throw new Error('context_overflow');}
  }
  return compact;
}
