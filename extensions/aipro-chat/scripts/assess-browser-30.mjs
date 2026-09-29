import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {browserTasks30} from '../evaluation/browser-30.mjs';
import {browserScore, parsedReviewEvidence} from '../evaluation/browser-score.mjs';
const [path, gradesPath] = process.argv.slice(2);
if (!path) throw new Error('Usage: node scripts/assess-browser-30.mjs REPORT.json [GRADES.json]');
const raw = await readFile(path);
const report = JSON.parse(raw);
if (report.suite !== 'browser-30-v1' || !Array.isArray(report.plannedTaskIds) || new Set(report.plannedTaskIds).size !== report.plannedTaskIds.length) throw new Error('invalid_evaluation_suite');
const tasks = report.plannedTaskIds.map(id => {
  const task = browserTasks30.find(task => task.id === id);
  if (!task) throw new Error('invalid_evaluation_task');
  return task;
});
const grades = JSON.parse(await readFile(gradesPath || path + '.grades.json'));
const trials = report.trials.map(trial => {
  const evidence = parsedReviewEvidence(trial, report.model);
  return {...trial, responseEvidence: evidence, actualModel: trial.actualModel || evidence.verified,
    modelValidResponses: Math.max(trial.modelValidResponses || 0, evidence.verifiedResponsesLowerBound)};
});
const assessment = {sourceReport: path, sourceReportSha256: createHash('sha256').update(raw).digest('hex'),
  assessedAt: new Date().toISOString(), status: report.status, score: browserScore(tasks, trials, grades),
  responseEvidence: trials.map(trial => ({id: trial.id, ...trial.responseEvidence})),
  note: 'Derived assessment. Original transport observations are unchanged. Parsed review outputs establish response receipt only; correctness requires independent checks.'};
await writeFile(path + '.assessment.json', JSON.stringify(assessment, null, 2));
console.log(JSON.stringify({status: assessment.status, total: assessment.score.total, cases: assessment.score.cases.filter(item => item.status !== 'not_run')}));
