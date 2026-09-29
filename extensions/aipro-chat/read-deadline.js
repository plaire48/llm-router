// Only for pure reference reads and cancellation-aware analysis waits. A timed
// out write may still execute; never use this helper to release browser writes.
export const REFERENCE_READ_TIMEOUT_MS = 45000;
export async function waitForRead(operation, {signal, timeoutMs = REFERENCE_READ_TIMEOUT_MS} = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort('cancelled');
  let timer, rejectAbort;
  const interruption = new Promise((_, reject) => {
    rejectAbort = () => reject(new Error(controller.signal.reason === 'read_timeout' ? 'read_timeout' : 'cancelled'));
    controller.signal.addEventListener('abort', rejectAbort, {once: true});
  });
  signal?.addEventListener('abort', cancel, {once: true});
  if (signal?.aborted) cancel();
  if (timeoutMs > 0) timer = setTimeout(() => controller.abort('read_timeout'), timeoutMs);
  try {
    return await Promise.race([interruption, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('cancelled');
      return operation(controller.signal);
    })]);
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}

export function createReferenceReads() {
  const pending = new Map();
  return {
    async run(requestId, operation, options = {}) {
      const controller = new AbortController(), set = pending.get(requestId) || new Set();
      set.add(controller); pending.set(requestId, set);
      try {return await waitForRead(operation, {...options, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal});}
      finally {set.delete(controller); if (!set.size && pending.get(requestId) === set) pending.delete(requestId);}
    },
    cancel(requestId) {for (const controller of pending.get(requestId) || []) controller.abort();},
  };
}
