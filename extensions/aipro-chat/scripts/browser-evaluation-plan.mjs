import {browserTasks30, selectBrowserTasks} from '../evaluation/browser-30.mjs';
import {writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {trainingText} from '../evaluation/browser-fixtures.mjs';
export function evaluationSelection(env = process.env) {
  return selectBrowserTasks({difficulty: env.NUBI_EVAL_DIFFICULTY, ids: env.NUBI_EVAL_TASK_IDS, environment: env.NUBI_EVAL_ENVIRONMENT});
}
export function browserEvaluationPlan(tasks = browserTasks30) {
  return {version: 1, suite: 'browser-30-v1', totalTasks: 30, selectedTasks: tasks.length,
    actualModel: false, accuracy: null, status: 'not_run',
    tasks: tasks.map(task => ({...task, status: 'not_run', outcomeChecks: task.checks.map(check => ({check, passed: null, evidence: []}))}))};
}
export function browserEvaluationMarkdown(tasks = browserTasks30) {
  return '# 브라우저 기능 평가 30개\n\n쉬움 10개, 중간 10개, 어려움 10개. 제품 품질 점수와 공식 벤치마크 점수는 아직 측정하지 않았다.\n\n' +
    '| ID | 난이도 | 과제 | 환경 | 확인할 기능 |\n|---|---|---|---|---|\n' + tasks.map(t => `| ${t.id} | ${{easy: '쉬움', medium: '중간', hard: '어려움'}[t.difficulty]} | ${t.title} | ${t.domain} | ${t.capabilities.join(', ')} |`).join('\n') +
    '\n\n' + tasks.map(t => `## ${t.id} ${t.title}\n\n${t.goal}\n\n시작: ${t.startUrl}\n\n완료 기준:\n\n${t.checks.map(c => `- ${c}`).join('\n')}${t.operator ? `\n\n평가자 진행: ${t.operator.before || t.operator.after}\n\n${t.operator.expected}` : ''}`).join('\n\n') + '\n';
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tasks = evaluationSelection();
  const root = new URL('../', import.meta.url);
  await mkdir(new URL('verification/browser-30/', root), {recursive: true});
  await writeFile(new URL('verification/browser-30/plan.json', root), JSON.stringify(browserEvaluationPlan(tasks), null, 2));
  await writeFile(new URL('verification/browser-30/tasks.md', root), browserEvaluationMarkdown(tasks));
  await writeFile(new URL('verification/browser-30/training.txt', root), trainingText);
  console.log(JSON.stringify({selected: tasks.length, levels: Object.fromEntries(['easy', 'medium', 'hard'].map(level => [level, tasks.filter(t => t.difficulty === level).length])), public: tasks.filter(t => t.environment === 'public-live').length, local: tasks.filter(t => t.environment === 'local-fixture').length, status: 'not_run', accuracy: null}));
}
