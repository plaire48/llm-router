import {FIELD_LABELS,FORMAT_FIELDS} from './cell-format.mjs';
// Public execution events, never model reasoning or invented progress.
export function createActivityLog(now = Date.now) {
  const events = [];let sequence=0;
  return {
    start(title, {kind = 'tool', detail = '', tool = ''} = {}) {
      const event = {id: ++sequence, kind, title: title.slice(0, 200), detail: detail.slice(0, 240), tool, state: 'running', startedAt: now()};
      events.push(event);if(events.length>240){const removable=events.findIndex(e=>e.state!=='running');if(removable>=0)events.splice(removable,1);} return event;
    },
    end(event, {title, detail, state = 'done'} = {}) {
      if (event.state !== 'running') return;
      event.state = state; event.endedAt = now();
      if (title) event.title = title.slice(0, 200);
      if (detail !== undefined) event.detail = detail.slice(0, 240);
    },
    note(title, detail = '') {
      const event = this.start(title, {kind: 'commentary', detail}); this.end(event); return event;
    },
    settle(state) {for (const event of events) if (event.state === 'running') this.end(event, {state});},
    snapshot() {return events.map(event => ({...event}));}
  };
}
export function describeChanges(plan) {
  return plan.operations.slice(0, 3).map(op => {
    if (op.type === 'set_values') return op.values.length === 1 && op.values[0].length === 1 ? `${op.address} ← ${String(op.values[0][0] ?? '비어 있음').slice(0, 64)}` : `${op.address}, ${op.values.length * op.values[0].length}개 셀 값 입력`;
    if (op.type === 'set_formulas') return `${op.address} 수식 입력`;
    return `${op.address}, ${FORMAT_FIELDS.filter(field=>Object.hasOwn(op,field)).map(field=>FIELD_LABELS[field]).join(', ')}`;
  }).join(' / ');
}
