import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {browserTasksAll as browserTasks30} from '../evaluation/browser-30.mjs';
import {fixtureGrade} from '../evaluation/browser-fixture-grades.mjs';
const [path] = process.argv.slice(2);
if (!path) throw Error('Usage: node scripts/grade-browser-fixtures.mjs REPORT.json');
const raw = await readFile(path), report = JSON.parse(raw);
if (report.suite !== 'browser-30-v1' || !Array.isArray(report.plannedTaskIds) || !Array.isArray(report.trials) ||
    new Set(report.plannedTaskIds).size !== report.plannedTaskIds.length || new Set(report.trials.map(t=>t.id)).size !== report.trials.length ||
    report.plannedTaskIds.some(id=>!browserTasks30.some(t=>t.id===id)) || report.trials.some(t=>!report.plannedTaskIds.includes(t.id))) throw Error('invalid_evaluation_membership');
const grades = report.trials.flatMap(trial => {
  const grade = fixtureGrade(browserTasks30.find(task => task.id === trial.id), trial);
  return grade ? [grade] : [];
});
const output = path + '.fixture-grades.json';
// Preserve manual grades and previous automated artifacts. A caller must choose
// how to reconcile partial checks; this tool never promotes incomplete grades.
await writeFile(output, JSON.stringify({sourceReport: path, sourceSha256: createHash('sha256').update(raw).digest('hex'),
  candidateSha256: report.candidateSha256, gradedAt: new Date().toISOString(), grades}, null, 2) + '\n', {flag:'wx'});
console.log(output);
