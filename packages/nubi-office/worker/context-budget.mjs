import {compactMessages} from './model-context.mjs';

// Local transport/attention budgets, NOT a claimed Qwen tokenizer or context
// capacity. Count the complete message + tool schema envelope, not just a body.
export const REQUEST_CHAR_LIMIT=240000;
export const CHECKPOINT_CHAR_LIMIT=120000;
export const requestChars=(messages,tools=[])=>JSON.stringify({messages,tools}).length;
export const needsContextCheckpoint=(messages,tools=[])=>messages.some(m=>m.role==='tool')&&requestChars(messages,tools)>CHECKPOINT_CHAR_LIMIT;
export function prepareContextRequest(messages,tools=[],metrics={}) {
  const compact=compactMessages(messages,metrics),chars=requestChars(compact,tools);
  const state=metrics.requestContext??={requests:0,peakChars:0,peakUtf8Bytes:0,rejected:0,limitChars:REQUEST_CHAR_LIMIT,tokenCount:'unmeasured'};
  state.requests++;state.peakChars=Math.max(state.peakChars,chars);state.peakUtf8Bytes=Math.max(state.peakUtf8Bytes,Buffer.byteLength(JSON.stringify({messages:compact,tools})));
  if(chars>REQUEST_CHAR_LIMIT){state.rejected++;throw new Error('context_overflow');}
  return compact;
}
