// Durable user input belongs to a conversation and the credential that accepted it.
// It never represents approval, and observers cannot dequeue it.
export function inputMatches(item, binding) {
  return item.conversationId === binding.conversationId && item.provider === binding.provider && item.credentialReceivedAt === binding.credentialReceivedAt && (!binding.runId || item.runId === binding.runId);
}
export function enqueueInput(inbox = [], input, binding) {
  if (!['steer', 'queue'].includes(input.mode) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 16000 || typeof input.id !== 'string' || !/^[\w-]{1,80}$/.test(input.id)) throw new Error('agent_input_invalid');
  const previous = inbox.find(item => item.id === input.id);
  if (previous) {
    if (!inputMatches(previous,binding) || previous.text !== input.text.trim() || previous.mode !== input.mode) throw new Error('agent_input_invalid');
    return inbox;
  }
  if (inbox.length >= 20) throw new Error('agent_input_full');
  return [...inbox, {...binding, id:input.id, text:input.text.trim(), mode:input.mode, createdAt:Date.now()}];
}
export function nextInput(inbox = [], binding, mode) {
  // Paused chains stay paused while a different run can drain its own FIFO.
  // Within that chain, never skip an entry from a changed account.
  const item = inbox.find(item => (!binding.runId || item.runId === binding.runId) && (!mode || item.mode === mode));
  return item && inputMatches(item,binding) ? item : null;
}

export function reorderInput(inbox = [], {id, overId, order}, binding) {
  // Compare the drag-start snapshot inside the worker's serial queue. A message
  // consumed, inserted or moved in another view must not redirect this drop.
  if (!Array.isArray(order) || order.length !== inbox.length || order.some((value, i) => value !== inbox[i].id)) throw new Error('agent_input_changed');
  const from = inbox.findIndex(item => item.id === id), to = inbox.findIndex(item => item.id === overId);
  if (from < 0 || to < 0) throw new Error('agent_input_changed');
  const moving = inbox[from];
  if (moving.mode !== 'queue' || inbox[to].mode !== 'queue') throw new Error('agent_input_changed');
  const start = Math.min(from, to), end = Math.max(from, to);
  if (inbox.slice(start, end + 1).some(item => !['queue','steer'].includes(item.mode) || item.runId !== moving.runId || !inputMatches(item, binding))) throw new Error('agent_input_changed');
  // Steering is displayed in the transcript and consumed separately. Reorder
  // queue slots only, keeping every admitted steering item at its exact slot.
  const slots = inbox.flatMap((item, index) => index >= start && index <= end && item.mode === 'queue' ? [index] : []);
  const queued = slots.map(index => inbox[index]);
  queued.splice(slots.indexOf(to), 0, queued.splice(slots.indexOf(from), 1)[0]);
  const result = [...inbox];
  slots.forEach((index, position) => {result[index] = queued[position];});
  return result;
}
