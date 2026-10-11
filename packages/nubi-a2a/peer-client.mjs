import {taskApi, locateHub} from './client.mjs';
const fail = code => {throw new Error(code);};
// A lost reply may have reached the hub. Its message ID is kept for the retry.
const UNCERTAIN = new Set(['a2a_uncertain', 'a2a_unavailable']);
const empty = () => ({pending: {}, run: null, sent: {}});

// Browser side of nubi-task-v1. The pairing is the collaboration flow's own
// (session a2a.connection). This keeps retry IDs, the run bound to an accepted
// task and the tasks each conversation sent. Nothing here reaches the model.
export function peerTasks({load, save, connection, saveConnection, ports}) {
  let queue = Promise.resolve();
  const serial = task => {const next = queue.then(task); queue = next.catch(() => {}); return next;};
  const state = async () => ({...empty(), ...(await load() || {})});
  async function call(use) {
    const current = await connection();
    if (!current) fail('a2a_expired');
    let api;
    try {api = await taskApi(current);}
    catch (error) {
      // A restarted desktop may listen on another port of the shared range.
      if (error.message !== 'a2a_unavailable') throw error;
      const moved = await locateHub(current, ports ? {ports} : {});
      await saveConnection(moved);
      api = await taskApi(moved);
    }
    return use(api);
  }
  async function change(key, send) {
    const before = await state(), messageId = before.pending[key] || crypto.randomUUID();
    if (!before.pending[key]) await save({...before, pending: {...before.pending, [key]: messageId}});
    try {
      const result = await call(api => send(api, messageId));
      const after = await state(); delete after.pending[key]; await save(after);
      return result;
    } catch (error) {
      if (!UNCERTAIN.has(error.message)) {const after = await state(); delete after.pending[key]; await save(after);}
      throw error;
    }
  }
  return {
    list: () => serial(() => call(api => api.list({pageSize: 25}))),
    get: id => serial(() => call(api => api.get(id))),
    accept: id => serial(() => change(`accept:${id}`, (api, messageId) => api.accept(id, {messageId}))),
    reject: (id, reason) => serial(() => change(`reject:${id}`, (api, messageId) => api.reject(id, reason, {messageId}))),
    fail: (id, reason) => serial(() => change(`fail:${id}`, (api, messageId) => api.fail(id, reason, {messageId}))),
    complete: (id, result) => serial(() => change(`complete:${id}`, (api, messageId) => api.complete(id, result, {messageId}))),
    // Progress is advisory: a lost update is not sent again.
    progress: (id, text) => serial(() => call(api => api.progress(id, text))),
    cancel: id => serial(() => call(api => api.cancel(id))),
    // key names the caller's attempt (a tool call), so a retried call answers
    // with the task it already sent instead of sending another.
    request: (task, {key, conversationId}) => serial(async () => {
      const known = (await state()).requested?.[key];
      if (known) return call(api => api.get(known));
      const sent = await change(`request:${key}`, (api, messageId) => api.request(task, {messageId}));
      const after = await state(), ids = after.sent[conversationId] || [];
      await save({...after, requested: Object.fromEntries([...Object.entries(after.requested || {}), [key, sent.id]].slice(-50)),
        sent: {...after.sent, [conversationId]: [...ids.filter(id => id !== sent.id), sent.id].slice(-20)}});
      return sent;
    }),
    sentBy: async conversationId => (await state()).sent[conversationId] || [],
    run: async () => (await state()).run,
    bindRun: run => serial(async () => save({...await state(), run})),
    updateRun: patch => serial(async () => {const current = await state(); if (current.run) await save({...current, run: {...current.run, ...patch}}); return current.run ? {...current.run, ...patch} : null;}),
    clearRun: taskId => serial(async () => {const current = await state(); if (current.run?.taskId === taskId) await save({...current, run: null});}),
  };
}
