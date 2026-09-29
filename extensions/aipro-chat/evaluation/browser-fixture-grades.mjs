import {workSheetTasks, workSheetDays, workSheetStart, mailListTarget} from './browser-fixtures.mjs';
// Independent readback grading for fixed, deterministic fixture outcomes.
// The executing model's answer, plan and self-review are never proof here.
export function fixtureGrade(task, trial) {
  if (task.environment !== 'local-fixture' || task.id !== trial.id || !['E-09', 'E-10', 'M-07', 'M-08', 'W-01', 'W-02'].includes(task.id)) return null;
  let start;
  try {start = new URL(trial.startUrl);} catch {return null;}
  if (start.protocol !== 'http:' || start.hostname !== '127.0.0.1' || start.pathname !== '/' + task.id ||
      !trial.target?.observed || !Number.isInteger(trial.target.tabId) || trial.targetPage?.url !== start.href) return null;
  const frames = trial.fixtureState;
  if (!Array.isArray(frames) || new Set(frames.map(frame => frame.frameId)).size !== frames.length ||
      frames.some(frame => !Number.isInteger(frame.frameId) || !frame.documentId || !Array.isArray(frame.fields))) return null;
  const top = frames.find(frame => frame.frameId === 0 && frame.url === start.href);
  if (!top) return null;
  const check = (passed, detail) => ({passed, evidence: [detail]});
  const field = (frame, predicate) => {const matches = frame.fields.filter(predicate);return matches.length === 1 ? matches[0] : null;};
  const equal = (value, expected, detail) => check(value === undefined ? null : value === expected, `${detail}: ${JSON.stringify(value ?? null)}; expected ${JSON.stringify(expected)}`);
  const submits = frame => equal(frame.counters?.submits, 0, `frame ${frame.frameId} submission count`);
  let checks;
  if (task.id === 'E-10') checks = [equal(top.toggle, 'true', 'actual aria-checked'), equal(top.counters?.toggles, 0, 'actual toggle count')];
  if (task.id === 'E-09') checks = [equal(field(top, f => f.id === 'title')?.value, '가을 교육', 'actual title'),
    check(null, 'The frozen prompt is ambiguous about first-line punctuation; retain manual adjudication instead of granting a pass or tightening the rubric after observing the answer.'), submits(top)];
  if (task.id === 'M-07') {
    const children = frames.filter(frame => frame.frameId !== 0);
    const child = children.length === 1 && children[0].url === start.origin + '/applicant' ? children[0] : null;
    if (!child) return null;
    checks = [equal(field(child, f => f.id === 'applicant')?.value, '홍길동', 'applicant frame name'),
      check(top.fields.length === 2 ? top.fields[0].value === '예시 보존' && top.fields[1].value === '담당자 보존' : null, 'Top-level reference/applicant-owner fields must preserve their original values in DOM order'),
      check(frames.every(f => Number.isInteger(f.counters?.submits)) ? frames.every(f => f.counters.submits === 0) : null, 'Every observed frame must report zero submissions')];
  }
  if (task.id === 'M-08') {
    const type = field(top, f => ['참석유형', '참석유형현장온라인'].includes(String(f.label || '').replace(/\s/g, ''))), email = field(top, f => f.label === '이메일');
    checks = [equal(top.modalOpen, true, 'actual open dialog'),
      check(type && email ? type.value === '온라인' && email.value === 'demo@example.test' : null, 'Actual attendance selection and conditional email value'),
      equal(field(top, f => ['현장메모', '현장메모기존현장안내'].includes(String(f.label || '').replace(/\s/g, '')))?.value, '기존 현장 안내', 'original onsite note'), submits(top)];
  }
  if (task.id === 'W-01') {
    // Inputs in document order: one per task row and day.
    const values = top.fields.map(field => field.value), cells = workSheetTasks.length * workSheetDays.length;
    const row = workSheetTasks.indexOf('데이터 시스템 모니터링'), target = new Set([row * 7 + 2, row * 7 + 3]);
    const expected = index => target.has(index) ? '4' : workSheetStart(Math.floor(index / 7), index % 7);
    const applied = top.counters?.appliedValues;
    checks = [check(values.length === cells ? values[row * 7 + 2] === '4' && values[row * 7 + 3] === '4' : null, `target cells: ${JSON.stringify([values[row * 7 + 2], values[row * 7 + 3]])}`),
      check(values.length === cells ? values.every((value, index) => target.has(index) || value === expected(index)) : null, `other cells changed: ${values.filter((value, index) => !target.has(index) && value !== expected(index)).length}`),
      check(Number.isInteger(top.counters?.applies) ? top.counters.applies === 1 && Array.isArray(applied) && applied.length === cells && applied.every((value, index) => value === expected(index)) : null,
        `applies ${JSON.stringify(top.counters?.applies)}, values at apply ${Array.isArray(applied) ? applied.every((value, index) => value === expected(index)) ? 'as requested' : 'not as requested' : 'none'}`)];
  }
  if (task.id === 'W-02') {
    const starred = top.counters?.starred, opened = top.counters?.opened;
    const answer = String(trial.answer || '');
    checks = [check(Array.isArray(starred) ? starred.length === 1 && starred[0] === mailListTarget : null, `starred rows: ${JSON.stringify(starred ?? null)}`),
      check(Array.isArray(opened) ? opened.includes(mailListTarget) && opened.every(row => row === mailListTarget) : null, `opened rows: ${JSON.stringify(opened ?? null)}`),
      check(answer ? /10월\s*15일/.test(answer) && /대강당/.test(answer) : null, 'The answer names 10월 15일 and 대강당 from the opened mail')];
  }
  if (!checks || checks.length !== task.checks.length) return null;
  return {id: task.id, grader: 'independent-fixture-readback-v1', checks: checks.map((result, index) => ({check: task.checks[index], ...result}))};
}
