import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {releaseInfo} from './release-info.mjs';
import {qualityScorecard, qualityMarkdown} from './quality-scorecard.mjs';
import {digestTree, verificationInputs} from './verification-inputs.mjs';
import {browserVerificationPlan} from './browser-verification-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const repeats = Number(process.env.NUBI_TEST_REPEATS || 3);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('NUBI_TEST_REPEATS must be an integer from 1 to 10');
const concurrency = Number(process.env.NUBI_TEST_CONCURRENCY || 1);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error('NUBI_TEST_CONCURRENCY must be an integer from 1 to 3');
const id = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve('verification', `pre-release-${id}`);
await mkdir(output, {recursive: true});
const report = {startedAt: new Date().toISOString(), status: 'running', repeats, concurrency,
  evidence: {actualBrowser: true, syntheticSite: true, actualModel: false, liveAccount: false},
  releaseApproved: false, stages: []};
const reportPath = resolve(output, 'report.json');
let pendingWrite = Promise.resolve();
const persist = () => {const text = JSON.stringify(report, null, 2) + '\n'; return pendingWrite = pendingWrite.then(() => writeFile(reportPath, text));};
await persist();

// These regressions are especially sensitive to lifecycle and DOM timing.
// Every repetition creates a fresh profile; failure stops, it is not retried
// until green. Both login receivers and provider transitions repeat too.
const repeated = ['browser-pdf-render-browser', 'browser-pdf-browser', 'semantic-input-receipt-browser', 'browser-script-receipt-browser', 'region-extension-browser', 'sequential-plan-browser', 'source-reference-browser', 'browser-routines-browser', 'browser-diagnostics-browser', 'wiki-search-browser', 'form-reconciliation-browser', 'uncertain-frame-browser', 'plan-mode-browser', 'browser-wiki-browser', 'workflow-knowledge-browser', 'subagent-progress-browser', 'form-workflow-browser', 'native-dialog-browser', 'harness-repair-browser', 'model-stall-browser', 'agent-input-browser', 'steering-transcript-browser', 'page-content-browser', 'document-retrieval-browser', 'background-lifetime-browser', 'completion-review-browser', 'page-information-browser', 'analysis-delivery-browser', 'review-context-browser', 'review-budget-browser', 'review-recovery-browser', 'keyboard-interaction-browser', 'click-feedback-browser', 'approval-labels-browser', 'hover-links-browser', 'workspace-browser', 'workspace-flow-browser', 'pointer-browser', 'harness-seven-browser', 'captures-browser', 'full-page-captures-browser', 'capture-coverage-browser', 'retrieval-browser', 'context-browser', 'state-sync-browser', 'outcome-recovery-browser', 'rich-editor-browser', 'error-recovery-browser', 'role-agents-browser', 'output-recovery-browser', 'vision-routing-browser', 'model-catalog-refresh-browser', 'toggle-recovery-browser', 'link-actions-browser', 'task-plan-browser', 'page-analysis-browser', 'analysis-recovery-browser', 'clarification-browser', 'question-forms-browser', 'attachments-browser', 'clipboard-documents-browser', 'browser-workflows-browser', 'browser-specialist-browser', 'browser-agent-browser',
  'browser-popups-browser', 'popup-approval-browser', 'script-preflight-browser', 'script-recovery-browser', 'harness-browser',
  'login-redirect-browser', 'chatgpt-login-redirect-browser', 'provider-switch-browser', 'conversations-browser'];
const once = ['debug-plan-ui-browser', 'verification-text-feedback-browser', 'region-read-browser', 'link-destination-browser', 'verification-context-browser', 'evaluation-submit-browser', 'capture-reattach-browser', 'text-region-browser', 'search-approval-browser', 'pagination-reference-browser', 'workspace-group-browser', 'evaluation-build-browser', 'resume-target-browser', 'action-pressure-browser', 'analysis-backpressure-browser', 'read-loop-recovery-browser', 'agent-diagnostic-journal-browser', 'final-gap-recovery-browser', 'research-source-browser', 'composer-add-browser', 'browser-dom-actionability-browser', 'browser-policy-browser', 'prompt-shortcuts-browser', 'large-document-browser', 'trace-journal-browser', 'restart-write-browser', 'native-dialog-approval-browser', 'webarena-har-browser', 'wiki-quality-browser', 'analysis-retention-browser', 'evaluation-evidence-browser', 'openwiki-agent-browser', 'integrations-browser', 'a2a-browser', 'typography-browser', 'csp-browser', 'chatgpt-browser', 'browser-debugger-browser', 'approval-browser',
  'side-panel-browser', 'chatgpt-side-panel-browser',
  'fabrix-browser', 'account-usage-browser', 'image-choice-browser',
  'page-images-browser', 'code-browser',
  'browser', 'ui-simplicity-browser', 'feedback-browser', 'mascot-browser', 'welcome-browser',
  'accessibility-browser', 'models-browser', 'chat-browser', 'usage-browser', 'page-skills-browser',
  'openwiki-browser', 'openwiki-ui-browser', 'openwiki-screen-browser', 'wiki-folder-browser', 'wiki-folder-persistence-browser'];
let selected;

async function stage(name, command, args, timeoutMs = 240000) {
  const record = {name, status: 'running', startedAt: new Date().toISOString(), log: `${name}.log`};
  report.stages.push(record); await persist();
  console.log(`RUN ${name}`);
  const log = createWriteStream(resolve(output, record.log));
  const start = Date.now();
  try {
    const result = await new Promise((resolveResult, reject) => {
      // Native window focus needs a visible browser and exclusive desktop use.
      // Headless focus emulation is not evidence of OS foreground restoration.
      const env = name.startsWith('workspace-browser-') ? {...process.env, HEADED: '1'} : process.env;
      const child = spawn(command, args, {cwd: root, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
      child.stdout.pipe(log, {end: false});child.stderr.pipe(log, {end: false});
      let timedOut = false, killTimer;
      const killTree = signal => {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
          killer.on('error', () => child.kill());
        } else {try {process.kill(-child.pid, signal);} catch { /* Already exited. */ }}
      };
      const timer = setTimeout(() => {
        timedOut = true;killTree('SIGTERM');killTimer = setTimeout(()=>killTree('SIGKILL'), 2000);
      }, timeoutMs);
      child.once('error', error => {clearTimeout(timer);clearTimeout(killTimer);reject(error);});
      child.once('close', (code, signal) => {clearTimeout(timer);clearTimeout(killTimer);resolveResult({exitCode:code, signal, timedOut});});
    });
    Object.assign(record, result, {durationMs: Date.now() - start, status: result.exitCode === 0 && !result.timedOut ? 'passed' : 'failed'});
    if (record.status !== 'passed') throw new Error(`${name} failed; see ${resolve(output, record.log)}`);
    if (name.startsWith('workspace-browser-')) {
      const workspace = JSON.parse(await readFile('verification/workspace-browser.json','utf8'));
      record.focusIsolationVerified = workspace.focusIsolationVerified;
      record.popupFocus = workspace.popupFocus;
      if (!workspace.focusIsolationVerified) report.releaseBlockers = ['native_popup_focus_not_restored'];
    }
    console.log(`PASS ${name} (${(record.durationMs / 1000).toFixed(1)}s)`);
  } catch (error) {
    record.status = 'failed';record.durationMs = Date.now() - start;
    throw error;
  } finally {
    await new Promise(resolveEnd=>log.end(resolveEnd)); await persist();
  }
}

async function browserStages(jobs) {
  const focusJobs = jobs.filter(([, suite]) => suite === 'workspace-browser');
  jobs = jobs.filter(([, suite]) => suite !== 'workspace-browser');
  let next = 0, failure;
  await Promise.all(Array.from({length: concurrency}, async () => {
    while (!failure && next < jobs.length) {
      const [name, suite] = jobs[next++];
      try {await stage(name, process.execPath, [`tests/${suite}.mjs`]);}
      catch (error) {failure ||= error;}
    }
  }));
  if (failure) throw failure;
  for (const [name, suite] of focusJobs) await stage(name, process.execPath, [`tests/${suite}.mjs`]);
}

try {
  const plan = browserVerificationPlan({args: process.argv.slice(2), suiteFilter: process.env.NUBI_TEST_SUITES, repeated, once, repeats});
  selected = plan.selected;
  Object.assign(report, {profile: plan.profile, selection: plan.selection, fullMatrix: plan.fullMatrix});
  if (process.env.TEST_EXTENSION || process.env.EXPECT_LEGACY) throw new Error('Clear TEST_EXTENSION and EXPECT_LEGACY before verifying the current candidate');
  if (process.env.HEADED === '1' && concurrency !== 1) throw new Error('Headed verification must run serially to preserve focus');
  const npmCLI = process.env.npm_execpath;
  if (!npmCLI) throw new Error('Run this verifier with npm run verify:browser');
  report.inputSha256 = await verificationInputs(root);
  await persist();
  await stage('unit', process.execPath, [npmCLI, 'test']);
  await stage('design', process.execPath, [npmCLI, 'run', 'design:check']);
  await stage('candidate-build', process.execPath, [npmCLI, 'run', 'build:candidate']);
  const release = releaseInfo(JSON.parse(await readFile('dist/manifest.json', 'utf8')), JSON.parse(await readFile('package.json', 'utf8')));
  Object.assign(report, release);
  report.buildSha256 = await digestTree(resolve('dist'));
  const archive = resolve('verification/candidate', `${release.archiveStem}-candidate.zip`);
  report.archiveSha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  await copyFile(archive, resolve(output, 'candidate.zip'));
  await persist();
  for (let round = 1; round <= repeats; round++) {
    await browserStages(repeated.filter(name=>!selected||selected.includes(name)).map(name => [`${name}-${round}`, name]));
  }
  await browserStages(once.filter(name=>!selected||selected.includes(name)).map(name => [name, name]));
  if (report.buildSha256 !== await digestTree(resolve('dist'))) throw new Error('Build changed during verification; results cannot certify this candidate');
  if (JSON.stringify(report.inputSha256) !== JSON.stringify(await verificationInputs(root))) throw new Error('Source, tests or dependency inputs changed during verification; results cannot certify this candidate');
  report.status = report.releaseBlockers?.length ? 'passed_with_limitations' : 'passed';
} catch (error) {
  report.status = 'failed';report.failure = error.message;process.exitCode = 1;
  console.error(error.message);
} finally {
  report.finishedAt = new Date().toISOString();await persist();
  const quality = qualityScorecard(report);
  await writeFile(resolve(output, 'quality.json'), JSON.stringify(quality, null, 2) + '\n');
  await writeFile(resolve(output, 'QUALITY.md'), qualityMarkdown(quality));
  console.log(`Report: ${reportPath}`);
  console.log('Live provider/model evaluation remains separate. No release was uploaded.');
}
