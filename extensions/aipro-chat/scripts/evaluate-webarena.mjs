// Development-only adapter. Uses upstream scoring unchanged, never packaged.
import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';

export const UPSTREAM = Object.freeze({
  version: '1.2.3',
  commit: '6473f72db5dcefc97b5725b59e734504edc28a21',
  evaluator: '35c3385b1db4b3378657589f95f50defd4234bd36e5b93d44733fd561b01db4e',
  dataset: 'd65275660814663375028e9017e1f929e3c38321041b125795e2713b52243d30',
});
export function officialArtifactScore(taskIds, results) {
  if (!taskIds.length || new Set(taskIds).size !== taskIds.length || results.length !== taskIds.length) throw new Error('Incomplete or duplicate task results');
  const tasks = taskIds.map(taskId => {
    const found = results.filter(result => result.task_id === taskId);
    if (found.length !== 1) throw new Error('Missing or duplicate task result');
    const result = found[0];
    if (result.webarena_verified_version !== UPSTREAM.version || result.webarena_verified_evaluator_checksum !== UPSTREAM.evaluator || result.webarena_verified_data_checksum !== UPSTREAM.dataset) throw new Error('Upstream version or checksum mismatch');
    if (!['success', 'failure', 'error'].includes(result.status) || result.score !== (result.status === 'success' ? 1 : 0)) throw new Error('Invalid official result');
    return {taskId, status: result.status, score: result.score};
  });
  return {scope: 'official-evaluator-on-provided-artifacts', upstream: UPSTREAM, tasks,
    artifactSuccessRate: tasks.filter(task => task.status === 'success').length / tasks.length,
    // These files alone cannot establish which agent produced the run.
    agentRunVerified: false, nubiCapabilityScore: null, independentCertification: false};
}
const hash = data => createHash('sha256').update(data).digest('hex');
export async function evaluateArtifacts({logs, config, tasks, binary = process.env.NUBI_WEBARENA_BIN || 'webarena-verified', outputRoot = resolve('verification')}) {
  if (!/^\d+(,\d+)*$/.test(tasks || '')) throw new Error('Specify task IDs, for example --tasks 108');
  const taskIds = tasks.split(',').map(Number);
  if (new Set(taskIds).size !== taskIds.length || taskIds.some(id => !Number.isSafeInteger(id))) throw new Error('Invalid task IDs');
  const version = spawnSync(binary, ['--version'], {encoding: 'utf8', timeout: 30000});
  if (version.error || version.status !== 0 || version.stdout.trim() !== `webarena-verified ${UPSTREAM.version}`) throw new Error(`Install the evaluation-only webarena-verified==${UPSTREAM.version} in an isolated environment and set NUBI_WEBARENA_BIN`);
  const cfg = JSON.parse(await readFile(resolve(config), 'utf8'));
  if (!cfg.environments || cfg.test_data_file) throw new Error('Provide benchmark environments without replacing the official dataset');
  // Offline grading needs benchmark URLs, never site credentials.
  const sanitizedConfig = {environments: Object.fromEntries(Object.entries(cfg.environments).map(([key, value]) => [key, {urls: value.urls}]))};
  await mkdir(outputRoot, {recursive: true});
  const output = await mkdtemp(join(outputRoot, 'webarena-official-'));
  const inputHashes = {};
  for (const id of taskIds) {
    await mkdir(join(output, String(id)));
    for (const name of ['agent_response.json', 'network.har']) {
      const data = await readFile(resolve(logs, String(id), name));
      JSON.parse(data.toString());
      await writeFile(join(output, String(id), name), data);
      inputHashes[`${id}/${name}`] = hash(data);
    }
  }
  const configText = JSON.stringify(sanitizedConfig);
  await writeFile(join(output, 'config.json'), configText);
  inputHashes.config = hash(configText);
  const run = spawnSync(binary, ['eval-tasks', '--task-ids', tasks, '--output-dir', output, '--config', join(output, 'config.json')], {encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024});
  await writeFile(join(output, 'evaluator.log'), (run.stdout || '') + (run.stderr || ''));
  if (run.error || run.status !== 0) throw new Error(`Official evaluator did not finish. Evidence: ${output}`);
  const results = await Promise.all(taskIds.map(async id => JSON.parse(await readFile(join(output, String(id), 'eval_result.json'), 'utf8'))));
  const report = {...officialArtifactScore(taskIds, results), inputHashes, finishedAt: new Date().toISOString()};
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  return {output, report};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {values} = parseArgs({options: {logs: {type: 'string'}, config: {type: 'string'}, tasks: {type: 'string'}}});
    if (!values.logs || !values.config) throw new Error('Usage: --logs <benchmark-run-directory> --config <benchmark-config.json> --tasks 108');
    const {output, report} = await evaluateArtifacts(values);
    console.log(JSON.stringify({output, artifactSuccessRate: report.artifactSuccessRate, nubiCapabilityScore: null}));
    process.exitCode = report.tasks.every(task => task.status === 'success') ? 0 : 1;
  } catch (error) {console.error(error.message); process.exitCode = 2;}
}
