// Independent factual grades remain separate from executor self-review.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserTasks30} from '../evaluation/browser-30.mjs';
import {browserScore} from '../evaluation/browser-score.mjs';

export function assessEasyBrowser(report, gradeEnvelope) {
  const tasks = browserTasks30.filter(task => task.difficulty === 'easy');
  if (!/^[a-f0-9]{64}$/.test(report.candidateSha256 || '') ||
      report.plannedTaskIds?.length !== tasks.length ||
      tasks.some((task, index) => report.plannedTaskIds[index] !== task.id)) throw Error('easy_suite_identity_mismatch');
  if (gradeEnvelope && (gradeEnvelope.candidateSha256 !== report.candidateSha256 ||
      gradeEnvelope.reportStartedAt !== report.startedAt)) throw Error('independent_grade_identity_mismatch');
  const score = browserScore(tasks, report.trials || [], gradeEnvelope?.grades || [], {targetRate: 1});
  return {candidateSha256: report.candidateSha256, reportStartedAt: report.startedAt,
    runStatus: report.status, model: report.model, score,
    accepted: score.total.target.achieved, note: '10/10 requires independent factual grades and complete visible task delivery on this candidate.'};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error('usage: node scripts/assess-easy-browser.mjs REPORT [GRADE_ENVELOPE]');
  const reportPath = resolve(process.argv[2]);
  const bytes = await readFile(reportPath);
  const grades = process.argv[3] ? JSON.parse(await readFile(resolve(process.argv[3]), 'utf8')) : undefined;
  const result = {...assessEasyBrowser(JSON.parse(bytes), grades), reportPath,
    reportSha256: createHash('sha256').update(bytes).digest('hex'), assessedAt: new Date().toISOString()};
  await writeFile(reportPath + '.easy-assessment.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({runStatus: result.runStatus, ...result.score.total}, null, 2));
}
