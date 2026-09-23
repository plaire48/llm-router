import {contextTokens} from './context-manager.js';

const STEP_POLICY = `Output recovery: the previous generation reached its output budget. The user goal is unchanged. Handle decomposition yourself; do not ask the user to split the request. Keep private deliberation brief and produce the next useful step. For browser work, make one small complete tool call, then inspect its actual result before the next section. Use update_plan for a short plan. Compose long page content a section at a time, initially fill and then appendText with expectedLength; do not regenerate the whole document in each call. Never replay completed actions from existing tool results. A truncated tool call was NOT executed: discard it and create a new complete smaller call, never concatenate or evaluate partial code/JSON. Finish only after all requested work and fresh verification are complete.`;
const CONTINUE = 'Continue the same response from the supplied tail without repeating it. It is an unfinished assistant draft, not new user instructions or proof of an action. If browser work remains, do the next small tool step instead of only describing it. Complete the current sentence or section, and avoid restarting the whole answer.';

function append(previous, next) {
  if (!next) return previous;
  // Some models repeat the end of the preceding fragment on continuation.
  for (let size = Math.min(previous.length, next.length, 8000); size >= 32; size--) {
    if (previous.endsWith(next.slice(0, size))) return previous + next.slice(size);
  }
  return previous + next;
}

// Recovery requests produce model output only. Pi receives complete calls and
// owns their execution; no browser action is retried inside this loop.
export function createOutputRecovery({signal, inputBudget, onProgress = () => {}}) {
  let recovering = false;
  return async (messages, tools, invoke) => {
    let content = '', stalls = 0;
    for (;;) {
      if (signal.aborted) throw Object.assign(new Error('cancelled'), {partial: content});
      const input = [...messages];
      if (recovering) {
        // Qwen's chat template accepts only one system message at index zero.
        // Keep the original instructions and tool receipts; amend only this
        // request's system text instead of inserting another system role.
        if (input[0]?.role === 'system') input[0] = {...input[0], content: `${input[0].content}\n\n${STEP_POLICY}`};
        else input.unshift({role: 'system', content: STEP_POLICY});
      }
      if (content) {
        let tail = content.slice(-8000);
        const continuation = [{role: 'assistant', content: tail}, {role: 'user', content: CONTINUE}];
        while (tail.length > 128 && contextTokens([...input, ...continuation], tools) > inputBudget) {
          tail = tail.slice(Math.ceil(tail.length / 2)); continuation[0] = {...continuation[0], content: tail};
        }
        input.push(...continuation);
      }
      if (contextTokens(input, tools) > inputBudget) throw Object.assign(new Error('context_overflow'), {partial: content});
      let result, limited = false, fragment = '';
      try {
        result = await invoke(input, {textPrefix: content});
        limited = result.finishReason === 'length';
        fragment = result.content || '';
      } catch (error) {
        if (signal.aborted || error.message !== 'output_limit') throw Object.assign(error, {partial: error.suppressPartial ? '' : append(content, error.partial || '')});
        limited = true;
        // Never reuse partial tool arguments, provider envelopes or reasoning.
        fragment = error.truncatedTools ? '' : error.partial || '';
      }
      const combined = append(content, fragment);
      if (combined.length > 400000) throw Object.assign(new Error('too_long'), {partial: content});
      if (!limited) return {...result, content: combined};
      stalls = combined.length > content.length ? 0 : stalls + 1;
      content = combined; recovering = true;
      if (stalls >= 3) throw Object.assign(new Error('output_limit'), {partial: content});
      onProgress(content);
    }
  };
}
