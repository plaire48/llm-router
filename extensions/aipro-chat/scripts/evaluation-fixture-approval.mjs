// An evaluation operator may approve only the frozen local transfer tasks.
// This never grants browser permissions or authorizes public-site mutations.
export function fixtureApprovalAllowed({enabled, taskId, origin, question, record, conversationId, pageUrl}) {
  if (!enabled || question?.kind !== 'approval' || question.answer || record?.questionId !== question.id ||
      record?.conversationId !== conversationId) return false;
  let page, fixture;
  try {page = new URL(pageUrl); fixture = new URL(origin);} catch {return false;}
  if (fixture.protocol !== 'http:' || fixture.hostname !== '127.0.0.1' || page.origin !== fixture.origin || page.pathname !== `/${taskId}`) return false;
  if (taskId === 'H-08' && record.operation?.method === 'download') {
    try {const url = new URL(record.operation.url); return url.origin === fixture.origin && url.pathname === '/training.txt' && !url.search && !url.hash;} catch {return false;}
  }
  // The work-system sheet's final apply is the requested outcome of that frozen task.
  if (taskId === 'W-01') return record.operation?.method === 'click' && record.action === '반영';
  return taskId === 'H-09' && record.operation?.method === 'upload' && record.operation.files?.length === 1 &&
    record.operation.files[0].name === 'training.txt';
}
