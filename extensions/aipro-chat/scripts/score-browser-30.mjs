import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {browserTasks30} from '../evaluation/browser-30.mjs';
import {browserScore} from '../evaluation/browser-score.mjs';
const [reportPath, gradesPath] = process.argv.slice(2);
if (!reportPath) throw new Error('Usage: node scripts/score-browser-30.mjs REPORT.json [GRADES.json]');
const report = JSON.parse(await readFile(resolve(reportPath), 'utf8'));
if (report.suite !== 'browser-30-v1') throw new Error('wrong_evaluation_suite');
if (!Array.isArray(report.plannedTaskIds) || !report.plannedTaskIds.length || new Set(report.plannedTaskIds).size !== report.plannedTaskIds.length || report.plannedTaskIds.some(id => !browserTasks30.some(task => task.id === id))) throw new Error('invalid_evaluation_plan');
const tasks = report.plannedTaskIds.map(id => browserTasks30.find(task => task.id === id));
if (!gradesPath) {
  const template = tasks.map(task => ({id: task.id, checks: task.checks.map(check => ({check, passed: null, evidence: []}))}));
  const output = resolve(reportPath + '.grades.json');
  await writeFile(output, JSON.stringify(template, null, 2), {flag: 'wx'});
  console.log(output);
} else {
  const grades = JSON.parse(await readFile(resolve(gradesPath), 'utf8'));
  const score = browserScore(tasks, report.trials, grades, {targetRate:report.targetRate ?? .8});
  const output = resolve(reportPath + '.score.json');
  await writeFile(output, JSON.stringify(score, null, 2));
  console.log(JSON.stringify(score.total));
}
