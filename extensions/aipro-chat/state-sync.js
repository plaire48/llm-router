import {QueryClient} from '@tanstack/query-core';

const key = ['extension-state'];
const invalidContext = error => /extension context invalidated/i.test(error?.message || '');
function boundedRead(read, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, data) => {if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(data);};
    const abort = () => finish(new Error('cancelled'));
    const timer = setTimeout(() => finish(new Error('state_timeout')), timeoutMs);
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) return abort();
    // Chrome messaging cannot cancel an already sent RPC. Ignore its late
    // response; retries here only read state and never replay an action.
    Promise.resolve().then(() => read(signal)).then(data => finish(null, data), error => finish(error));
  });
}

// One query cache per view. Failure budget belongs to this observer, not the
// Agent job. Storage notifications and timers cannot reopen an exhausted read.
export function createStateSync({read, onData, onStatus = () => {}, visible = () => true, intervalMs = 10000, timeoutMs = 8000,
  retryDelay = attempt => Math.min(1000 * 2 ** attempt, 4000) * (0.8 + Math.random() * 0.4)}) {
  const client = new QueryClient(); client.mount();
  let closed = false, paused = false, inFlight, trailing, timer, latest;
  function refresh() {
    if (closed || paused) return Promise.resolve();
    if (inFlight) return trailing ||= inFlight.then(() => {trailing = null; return refresh();});
    clearTimeout(timer);
    inFlight = client.query({queryKey: key, queryFn: ({signal}) => boundedRead(read, signal, timeoutMs), staleTime: 0, gcTime: Infinity,
      networkMode: 'always', retry: (count, error) => count < 2 && !invalidContext(error), retryDelay,
    }).then(data => {
      if (closed) return;
      latest = data; onData(data); onStatus({paused: false, reload: false});
    }).catch(error => {
      if (closed) return;
      paused = true; onStatus({paused: true, reload: invalidContext(error)});
    }).finally(() => {
      inFlight = null;
      if (!closed && !paused && !trailing && (latest?.busy || latest?.pending)) timer = setTimeout(() => {if (visible()) void refresh();}, intervalMs);
    });
    return inFlight;
  }
  return {
    refresh,
    invalidate() {
      if (closed || paused || !visible()) return;
      if (inFlight) {void refresh(); return;}
      clearTimeout(timer); timer = setTimeout(() => void refresh(), 80);
    },
    resume() {if (closed) return Promise.resolve(); paused = false; onStatus({paused: false, reload: false}); return refresh();},
    dispose() {closed = true; clearTimeout(timer); void client.cancelQueries({queryKey: key}); client.unmount(); client.clear();},
  };
}
