import pRetry from 'p-retry';
import isNetworkError from 'is-network-error';

export {retryAfterMs} from './http-retry.js';
// Attempt limits belong to inference, never the number of browser actions.
export const MODEL_WAIT_POLICY = Object.freeze({idleMs: 120000, attemptMs: 300000, slowMs: 15000});
// Image encoding/prefill can stall without producing a single usable delta.
// Keep active streaming's normal ceiling, but do not resend the same expensive
// image request automatically after silence. The existing task recovery owns it.
export const IMAGE_MODEL_WAIT_POLICY = Object.freeze({idleMs: 30000, attemptMs: 300000, slowMs: 8000, retries: 0});
const serverDelay = error => ([429, 503].includes(error?.status) || error?.retryable === true && ['rate_limited', 'upstream'].includes(error.message)) && Number.isFinite(error.retryAfterMs) && error.retryAfterMs >= 0 ? error.retryAfterMs : 0;
async function waitForRetry(ms, signal) {
  if (signal.aborted) throw new Error('cancelled');
  await new Promise((resolve, reject) => {
    const finish = () => {signal.removeEventListener('abort', cancel); resolve();};
    const timer = setTimeout(finish, ms);
    const cancel = () => {clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new Error('cancelled'));};
    signal.addEventListener('abort', cancel, {once: true});
  });
}

// Shared only by inference calls in this run (including role analysts). A 429
// from one analyst delays later requests too; an older success cannot clear it.
export function createModelCooldown({maxWaitMs = 60000, now = () => performance.now(), sleep = waitForRetry} = {}) {
  let until = 0, failure;
  return {
    allows(error) {return serverDelay(error) <= maxWaitMs;},
    hold(error) {
      const delay = serverDelay(error);
      if (delay && now() + delay > until) {
        until = now() + delay;
        failure = Object.assign(new Error(error.status === 429 || error.message === 'rate_limited' ? 'rate_limited' : 'upstream'), {status: error.status, retryAfterMs: delay});
      }
    },
    async wait(signal) {
      while (until > now()) {
        if (signal.aborted) throw new Error('cancelled');
        const delay = until - now();
        // Do not shorten a long server cooldown and send too early. Preserve
        // the existing paused task so the user can continue later instead.
        if (delay > maxWaitMs) throw failure;
        await sleep(delay, signal);
      }
    },
  };
}

export function retryableModelError(error) {
  if (error?.retryable === false || error?.status >= 400 && error.status < 500 && ![408, 429].includes(error.status) || ['cancelled', 'no_credential', 'expired_token', 'unauthorized', 'forbidden', 'response_filtered', 'output_limit', 'context_overflow', 'fabrix_tool_protocol', 'request_format', 'invalid_model'].includes(error?.message)) return false;
  return error?.retryable === true || isNetworkError(error) || ['network', 'model_timeout', 'model_stream_incomplete', 'chatgpt_network', 'fabrix_network'].includes(error?.message) || [408, 429, 500, 502, 503, 504].includes(error?.status);
}

// Retry inference only. Browser actions have already produced receipts and are
// never replayed by this transport helper. A successful attempt resets its budget.
export async function recoverModel(run, {signal, onRetry = () => {}, onSlow = () => {}, onResumed = () => {}, idleMs = MODEL_WAIT_POLICY.idleMs, attemptMs = MODEL_WAIT_POLICY.attemptMs, slowMs = MODEL_WAIT_POLICY.slowMs, minTimeout = 1000, retries = 3, cooldown = createModelCooldown()} = {}) {
  try {
    return await pRetry(async attempt => {
      if (signal.aborted) throw new Error('cancelled');
      await cooldown.wait(signal);
      if (signal.aborted) throw new Error('cancelled');
      const controller = new AbortController();
      let timer, slowTimer, rejectAbort, settled = false, slow = false;
      const hardTimer = setTimeout(() => controller.abort('model_timeout'), attemptMs);
      const abort = () => controller.abort('cancelled');
      const armIdle = () => {
        clearTimeout(timer); clearTimeout(slowTimer);
        timer = setTimeout(() => controller.abort('model_timeout'), idleMs);
        slowTimer = setTimeout(() => {
          if (settled || controller.signal.aborted) return;
          slow = true;
          try {onSlow(attempt);} catch { /* Presentation cannot interrupt inference. */ }
        }, slowMs);
      };
      // A long but actively streaming answer is not waiting. Only parsed model
      // events call activity; transport keepalives must not renew these clocks.
      const activity = () => {
        if (settled || controller.signal.aborted) return;
        if (slow) {slow = false; try {onResumed(attempt);} catch { /* Optional presentation. */ }}
        armIdle();
      };
      const interrupted = new Promise((_, reject) => {rejectAbort = () => reject(new Error(controller.signal.reason === 'model_timeout' ? 'model_timeout' : 'cancelled')); controller.signal.addEventListener('abort', rejectAbort, {once: true});});
      signal.addEventListener('abort', abort, {once: true}); armIdle();
      try {return await Promise.race([run({signal: controller.signal, activity, attempt}), interrupted]);}
      catch (error) {if (controller.signal.aborted) throw new Error(controller.signal.reason === 'model_timeout' ? 'model_timeout' : 'cancelled'); throw error;}
      finally {settled = true; clearTimeout(timer); clearTimeout(hardTimer); clearTimeout(slowTimer); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', rejectAbort);}
    }, {signal, retries, minTimeout, maxTimeout: 8000, factor: 2, randomize: true,
      shouldRetry: ({error}) => !signal.aborted && retryableModelError(error) && cooldown.allows(error),
      onFailedAttempt: ({error, attemptNumber, retriesLeft}) => {
        if (!signal.aborted && retryableModelError(error)) {
          cooldown.hold(error);
          if (retriesLeft && cooldown.allows(error)) {
            try {onRetry(attemptNumber, {status: error.status, code: error.message === 'model_timeout' ? 'model_timeout' : undefined, retryAfterMs: serverDelay(error)});} catch { /* Optional UI feedback cannot break recovery. */ }
          }
        }
      },
    });
  } catch (error) {if (signal.aborted) throw new Error('cancelled'); throw error;}
}

export function activityDeadline(onTimeout, duration, timers = globalThis) {
  let timer;
  return {touch() {timers.clearTimeout(timer); timer = timers.setTimeout(onTimeout, duration);}, stop() {timers.clearTimeout(timer);}};
}
