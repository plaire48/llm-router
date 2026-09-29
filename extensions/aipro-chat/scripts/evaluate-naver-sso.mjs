// Real Naver trials through Nubi's ChatGPT SSO UI. Never imports another app's credentials.
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, writeFile, appendFile, rm, mkdir, realpath, lstat} from 'node:fs/promises';
import {unzipSync} from 'fflate';
import {tmpdir} from 'node:os';
import {resolve, dirname, basename} from 'node:path';
import {waitForRead} from '../read-deadline.js';
import {fileURLToPath} from 'node:url';
import {naverTasks} from '../evaluation/naver-50.mjs';
import {naverTasksV2} from '../evaluation/naver-50-v2.mjs';
import {evaluationSelection} from './browser-evaluation-plan.mjs';
import {startBrowserFixtures, trainingText} from '../evaluation/browser-fixtures.mjs';
import {evaluationTarget, inspectEvaluationTarget} from './evaluation-target.mjs';
import {hasResponsesOutput, parsedReviewEvidence, browserScore} from '../evaluation/browser-score.mjs';
import {prepareEvaluationTrial, evaluationComposer, waitForEvaluationUI, submitEvaluationTask} from './evaluation-reset.mjs';
import {knowledgeProbe} from './evaluation-knowledge-probe.mjs';
import {prepareEvaluationBuild} from './evaluation-build.mjs';
import {fixtureApprovalAllowed} from './evaluation-fixture-approval.mjs';
import {modelExecutionTiming} from '../evaluation/browser-latency.mjs';
import {evaluationContentEvidence} from './evaluation-content-evidence.mjs';
import {publicSourceURL} from '../browser-public-url.js';
import {evaluationPublicRead} from './evaluation-public-read.mjs';
import {observeEvaluationDialogs} from './evaluation-dialogs.mjs';
import {validEvaluationAttachment} from './evaluation-attachment.mjs';
import {inspectEvaluationDelivery,waitForEvaluationDelivery} from './evaluation-delivery.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
// The same harness with another model tells a model limit from a harness fault.
const model = process.env.NUBI_EVAL_MODEL || 'gpt-5.6-luna';
if (!/^[a-z0-9][a-z0-9.-]{1,60}$/.test(model)) throw Error('invalid_evaluation_model');
const suite30 = process.env.NUBI_EVAL_TASK_SET === 'browser-30';
const fixtureApprovals = suite30 && process.env.NUBI_EVAL_FIXTURE_APPROVALS === '1';
const taskSet = suite30 ? evaluationSelection() : process.env.NUBI_EVAL_TASK_SET === 'v2' ? naverTasksV2 : naverTasks;
const startIndex = Number(process.env.NUBI_EVAL_START_INDEX || 0);
const requestedLimit = Number(process.env.NUBI_EVAL_LIMIT || taskSet.length);
if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= taskSet.length || !Number.isInteger(requestedLimit) || requestedLimit < 1) throw new Error('invalid_evaluation_range');
const limit = Math.min(taskSet.length - startIndex, requestedLimit);
const selectedTasks = taskSet.slice(startIndex, startIndex + limit);
const publicReadPages = process.env.NUBI_EVAL_CAPTURE_PUBLIC_READS === '1' && suite30 && selectedTasks.every(task=>task.environment==='public-live'&&task.readOnly)
  ? [...new Set(selectedTasks.map(task=>{const url=new URL(task.startUrl);return url.origin+url.pathname;}))] : [];
const targetRate = process.env.NUBI_EVAL_TARGET_RATE ? Number(process.env.NUBI_EVAL_TARGET_RATE) : suite30 && selectedTasks.length === 10 && selectedTasks.every((task, index) => task.id === `E-${String(index + 1).padStart(2, '0')}`) ? 1 : .8;
if (!Number.isFinite(targetRate) || targetRate <= 0 || targetRate > 1) throw Error('invalid_target_rate');
const loginTimeoutMs = Math.max(30000, Number(process.env.NUBI_EVAL_LOGIN_TIMEOUT_MS || 300000));
const trialTimeoutMs = Math.max(30000, Number(process.env.NUBI_EVAL_TRIAL_TIMEOUT_MS || 480000));
const maxModelRequests = Number(process.env.NUBI_EVAL_MAX_MODEL_REQUESTS || 80);
if (!Number.isSafeInteger(maxModelRequests) || maxModelRequests < 1 || maxModelRequests > 200) throw Error('invalid_model_budget');
const idleTimeoutMs = Math.max(30000, Number(process.env.NUBI_EVAL_IDLE_TIMEOUT_MS || 120000));
// Time for a person to read each result before the next task starts. It begins
// only after the task has ended and its answer or question is on screen, and
// it is not counted in the task's elapsed time.
const resultHoldMs = Number(process.env.NUBI_EVAL_RESULT_HOLD_MS || 0);
if (!Number.isSafeInteger(resultHoldMs) || resultHoldMs < 0 || resultHoldMs > 60000) throw Error('invalid_result_hold');
const output = resolve('verification', `naver-sso-${model.split('-').at(-1)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const evidenceDirectory = output.replace(/\.json$/, '-evidence');
const candidateArchive = resolve(process.env.NUBI_EVAL_CANDIDATE_ARCHIVE || 'verification/candidate/nubi-beta-1.0.0-candidate.zip');
const candidateBytes = await readFile(candidateArchive);
const candidateSha256 = createHash('sha256').update(candidateBytes).digest('hex');
const report = {version: 1, runId: randomUUID(), startedAt: new Date().toISOString(), status: 'initializing', evidenceDirectory, targetRate,
  completionCriteriaVersion: 2,
  site: suite30 ? 'mixed' : 'naver', suite: suite30 ? 'browser-30-v1' : 'naver-50', provider: 'chatgpt', model, build: 'candidate', candidateSha256, actualModel: false, taskCount: taskSet.length,
  taskSetVersion: taskSet === naverTasksV2 ? 2 : 1, startIndex, plannedTaskIds: taskSet.slice(startIndex, startIndex + limit).map(task => task.id),
  plannedTrials: limit, completedTrials: 0, accuracy: null, accuracyStatus: 'unscored_independent_grading_required', trials: []};
let stopRequested = false;
process.on('SIGINT', () => {stopRequested = true; console.log('STOP_REQUESTED: finishing the current trial safely');});
await mkdir('verification', {recursive: true});
await mkdir(evidenceDirectory, {recursive: true});
const save = () => writeFile(output, JSON.stringify(report, null, 2));
await save();
let profile;
if(process.env.NUBI_EVAL_REUSE_PROFILE){
  profile=await realpath(process.env.NUBI_EVAL_REUSE_PROFILE);
  if(dirname(profile)!==await realpath(tmpdir()) || !/^nubi-naversso-[A-Za-z0-9]+$/.test(basename(profile)) ||
    JSON.parse(await readFile(resolve(profile,'nubi-evaluation-profile.json'),'utf8')).kind!=='isolated-nubi-evaluation') throw Error('invalid_evaluation_profile');
}else{
  profile=await realpath(await mkdtemp(resolve(tmpdir(), 'nubi-naversso-')));
  await writeFile(resolve(profile,'nubi-evaluation-profile.json'),JSON.stringify({kind:'isolated-nubi-evaluation'}));
}
// Distinct candidate/evaluator content gets a new unpacked extension identity.
// Chrome can retain an old module graph at a reused path, and runtime.reload()
// can disable command-line-loaded extensions (Chromium issue 402532200).
const runnerSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
const attachment = process.env.NUBI_EVAL_ATTACH_REPORT ? JSON.parse(await readFile(resolve(process.env.NUBI_EVAL_ATTACH_REPORT), 'utf8')) : null;
const freshAfterInterruption = process.env.NUBI_EVAL_FRESH_AFTER_INTERRUPTION === '1';
const repeatRecorded = process.env.NUBI_EVAL_REPEAT_RECORDED === '1';
if (repeatRecorded && !attachment) throw Error('evaluation_repeat_requires_report');
if (attachment && !validEvaluationAttachment({attachment, reuseProfile:process.env.NUBI_EVAL_REUSE_PROFILE,
    candidateSha256, plannedTaskIds:report.plannedTaskIds, publicReadPages, fixtureApprovals, suite30, selectedTasks,
    freshAfterInterruption, repeatRecorded})) throw Error('invalid_evaluation_attachment');
const evaluatorSha256 = attachment?.evaluatorSha256 || runnerSha256;
report.runnerSha256 = runnerSha256;
const extension = resolve(profile, `extension-${candidateSha256.slice(0,16)}-${evaluatorSha256.slice(0,12)}`);
report.evaluatorSha256 = evaluatorSha256;
const evaluationVersion = `evaluation-${candidateSha256.slice(0,16)}-${evaluatorSha256.slice(0,12)}`;
const downloadsPath = resolve(profile, 'downloads', evaluationVersion);
let browser, context, child, fixtures;
const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolvePort(port));
  });
});
try {
  if (!attachment && await lstat(resolve(profile,'SingletonLock')).catch(error=>{if(error.code==='ENOENT')return null;throw error;})) throw Error('evaluation_profile_in_use');
  if (suite30 && taskSet.some(task => task.environment === 'local-fixture')) fixtures = await startBrowserFixtures();
  if (fixtures) {
    // chrome.downloads may use profile preferences rather than the CDP page
    // download directory. Isolate files per candidate to avoid user Downloads
    // collisions and verify the actual saved filename/hash reproducibly.
    await mkdir(downloadsPath,{recursive:true});await mkdir(resolve(profile,'Default'),{recursive:true});
    const preferencesPath=resolve(profile,'Default','Preferences');
    const preferences=await readFile(preferencesPath,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {};throw error;});
    preferences.download={...preferences.download,default_directory:downloadsPath,prompt_for_download:false};
    await writeFile(preferencesPath,JSON.stringify(preferences));
    report.downloadSetup={isolatedDirectory:true,scope:'candidate_evaluator',userDownloadsUnchanged:true};
  }
  if (!attachment) {
  await rm(extension, {recursive: true, force: true});
  // Execute the exact hashed ZIP, not whichever dist directory happens to exist.
  for (const [name, bytes] of Object.entries(unzipSync(candidateBytes))) {
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw Error('invalid_candidate_archive');
    if (name.endsWith('/')) continue;
    const destination = resolve(extension, name);
    await mkdir(dirname(destination), {recursive: true});
    await writeFile(destination, bytes);
  }
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.version_name = evaluationVersion;
  // Test-only public-source permission. The packaged product is untouched.
  // Match the product's optional origin request in this isolated test profile.
  // Missing HTTP caused a permission prompt even on HTTPS-only task pages.
  manifest.host_permissions.push('https://*/*', 'http://*/*');
  if (fixtureApprovals) {
    manifest.permissions = [...new Set([...manifest.permissions, 'downloads'])];
    manifest.optional_permissions = (manifest.optional_permissions || []).filter(name => name !== 'downloads');
    report.operatorSetup = {fixtureTransferApprovals: true, downloadsPermission: 'pregranted_in_isolated_test_manifest', nativePermissionPromptTested: false};
  }
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  // Observe the existing host protocol, including runtime-internal delegation
  // failures. Never capture credentials, request bodies or browser input values.
  const scriptEvidenceBundle = await build({stdin: {
    contents: "export {normalizeScriptCommandEvidence} from './review-execution.js';",
    resolveDir: process.cwd(), sourcefile: 'evaluation-script-evidence.js'},
    bundle: true, write: false, format: 'iife', globalName: 'NubiEvaluationScriptEvidence', platform: 'browser', target: 'chrome125'});
  await appendFile(resolve(extension, 'background.js'), '\n' + scriptEvidenceBundle.outputFiles[0].text);
  report.scriptEvidenceInstrumentationSha256 = createHash('sha256').update(scriptEvidenceBundle.outputFiles[0].text).digest('hex');
  await appendFile(resolve(extension, 'background.js'), `
const evalEvents = [], evalOriginalHandle = handle;
let evalEventSequence = 0, evalCallSequence = 0;
const evalRecord = event => {evalEvents.push({sequence:++evalEventSequence,...event});if(evalEvents.length>1000)evalEvents.splice(0,evalEvents.length-1000);};
const evalPublicSourceURL = ${publicSourceURL.toString()};
const evalContentEvidence = ${evaluationContentEvidence.toString()};
const evalPublicRead = ${evaluationPublicRead.toString()};
const evalPublicReadPages = ${JSON.stringify(publicReadPages)};
const evalCode = value => typeof value === 'string' && /^[a-z_]{1,64}$/.test(value) ? value : null;
// Sizes only, never content: shows which observation fields dominate model input.
const evalResultSize = result => {
  try {
    const observation = result?.observation || result, fields = {};
    for (const frame of Array.isArray(observation?.frames) ? observation.frames : []) for (const [key, value] of Object.entries(frame || {})) {
      if (!/^[A-Za-z_]{1,40}$/.test(key)) continue;
      fields[key] = (fields[key] || 0) + (JSON.stringify(value) || '').length;
    }
    const elements = (Array.isArray(observation?.frames) ? observation.frames : []).reduce((sum, frame) => sum + (Array.isArray(frame?.elements) ? frame.elements.length : 0), 0);
    return {total: (JSON.stringify(result) || '').length, elements, frameFields: fields};
  } catch {return null;}
};
handle = async function(message, sender, owner) {
  if (message?.type === 'GET_EVAL_DIAGNOSTICS' && trustedUI(sender)) return evalEvents.slice(-1000);
  const at = Date.now();
  // Token counts only. cached shows how much of the prompt the provider reused.
  if (message?.type === 'RECORD_USAGE' && ['report','finish'].includes(message.phase) && message.usage && typeof message.usage === 'object') {
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    evalRecord({kind:'usage',at,round:message.round,phase:message.phase,scope:['analysis','planning','review','compaction','execution'].includes(message.scope)?message.scope:null,
      promptTokens:count(message.usage.prompt_tokens),completionTokens:count(message.usage.completion_tokens),
      cachedTokens:count(message.usage.prompt_tokens_details?.cached_tokens),reasoningTokens:count(message.usage.completion_tokens_details?.reasoning_tokens)});
  }
  if (message?.type === 'RECORD_USAGE' && ['start','finish'].includes(message.phase)) evalRecord({kind:'model',at,round:message.round,phase:message.phase,scope:['analysis','planning','review','compaction','execution'].includes(message.scope)?message.scope:null,inputCharacters:Number.isSafeInteger(message.inputCharacters)?message.inputCharacters:null,inputSizeVersion:message.inputSizeVersion===1?1:null,...Object.fromEntries(['textInputCharacters','imageInputCharacters','schemaCharacters'].map(key=>[key,Number.isSafeInteger(message[key])&&message[key]>=0?message[key]:null])),toolCount:Number.isSafeInteger(message.toolCount)?message.toolCount:null});
  if (message?.type === 'MODEL_DIAGNOSTIC' && message.kind === 'agent') {
    if (message.phase === 'tool_result') evalRecord({kind:'tool_result',at,tool:evalCode(message.tool),error:evalCode(message.error),reason:evalCode(message.reason),...(Number.isInteger(message.pdfHttpStatus)&&message.pdfHttpStatus>=100&&message.pdfHttpStatus<=599?{pdfHttpStatus:message.pdfHttpStatus}:{}),...(Number.isInteger(message.pdfRequestAttempts)&&message.pdfRequestAttempts>=0&&message.pdfRequestAttempts<=3?{pdfRequestAttempts:message.pdfRequestAttempts}:{}),issues:message.issues,scopeIssues:message.scopeIssues,verificationChecks:message.tool==='verify_page'&&Array.isArray(message.verificationChecks)?message.verificationChecks.slice(0,24).map(check=>({kind:evalCode(check.kind),passed:check.passed===true,reason:evalCode(check.reason)})):undefined});
    if (message.phase === 'review_result') evalRecord({kind:'review',at,scope:message.scope,status:message.status,checks:message.checks,nextStep:message.nextStep,availableEvidence:message.availableEvidence});
  }
  if (message?.type !== 'RUN_TOOL') return evalOriginalHandle(message,sender,owner);
  const callId = ++evalCallSequence;
  evalRecord({kind:'browser_tool_start',at,callId,tool:evalCode(message.name),argumentKeys:Object.keys(message.args||{}).filter(key=>/^[a-z_]{1,64}$/.test(key))});
  try {
    const result = await evalOriginalHandle(message,sender,owner);
    evalRecord({kind:'browser_tool',at,callId,tool:message.name,elapsedMs:Date.now()-at,ok:typeof result?.ok==='boolean'?result.ok:null,error:evalCode(result?.error),reason:evalCode(result?.reason),verified:result?.verified===true,resultSize:evalResultSize(result),
      ...(message.name==='click_element'?{actionIssued:typeof result?.actionIssued==='boolean'?result.actionIssued:null,actionTargetReceipt:result?.actionTargetReceipt||null}:{}),
      ...(message.name==='run_playwright'?{scriptExecution:NubiEvaluationScriptEvidence.normalizeScriptCommandEvidence(result?.execution)}:{}),
      ...(['fill_form','press_key'].includes(message.name)?{inputExecution:NubiEvaluationScriptEvidence.normalizeScriptCommandEvidence(result?.inputExecution),actionIssued:typeof result?.actionIssued==='boolean'?result.actionIssued:null}:{}),
      ...(message.name==='list_tabs' && Array.isArray(result?.tabs)?{tabCount:result.tabs.length,currentTabListed:result.tabs.some(tab=>tab.current===true)}:{}),
      ...(['read_page','browser_snapshot'].includes(message.name)?{readObservation:{queryProvided:typeof message.args?.query==='string'&&message.args.query.trim().length>0,
        frameCount:Array.isArray(result?.frames)?result.frames.length:null,
        frames:Array.isArray(result?.frames)?result.frames.slice(0,16).map(frame=>({textCharacters:typeof frame.text==='string'?frame.text.length:null,
          textFiltered:typeof frame.textFiltered==='boolean'?frame.textFiltered:null,truncated:typeof frame.truncated==='boolean'?frame.truncated:null,
          retrievalMethod:['lexical','dom_order'].includes(frame.retrieval?.method)?frame.retrieval.method:null,
          textBlockCount:Array.isArray(frame.retrieval?.textBlocks)?frame.retrieval.textBlocks.length:null,
          textRegionCount:Array.isArray(frame.retrieval?.textRegions)?frame.retrieval.textRegions.length:null,
          contextOmitted:typeof frame.retrieval?.contextOmitted==='boolean'?frame.retrieval.contextOmitted:null})):[],
        omittedFrames:Array.isArray(result?.frames)?Math.max(0,result.frames.length-16):0}}:{}),
      ...(['read_page','browser_snapshot'].includes(message.name)&&evalPublicReadPages.length?{publicRead:evalPublicRead(result,evalPublicReadPages)}:{}),
      ...(result?.dataKind==='page_content'?{sourceEvidence:evalContentEvidence(result,evalPublicSourceURL),dataKind:'page_content',rangeCount:result.ranges?.length||0,contentHash:result.content_hash,characters:result.characters,partial:result.coverage?.partial,hasMore:result.next_offset!==null}: {})});
    if(evalEvents.length>1000)evalEvents.splice(0,evalEvents.length-1000);
    return result;
  } catch(error) {evalRecord({kind:'browser_tool',at,callId,tool:message.name,elapsedMs:Date.now()-at,error:evalCode(error.message)});throw error;}
};
// The worker handles messages one at a time. A handler that does not return
// holds every later read. Names and ages of running handlers only.
const evalInflight = new Map(), evalRecordedHandle = handle;
let evalInflightSequence = 0;
handle = async function(message, sender, owner) {
  const token = ++evalInflightSequence;
  evalInflight.set(token, {type: typeof message?.type === 'string' && /^[A-Z_]{1,40}$/.test(message.type) ? message.type : null, name: evalCode(message?.name), at: Date.now()});
  try {return await evalRecordedHandle(message, sender, owner);} finally {evalInflight.delete(token);}
};
// Answered outside that queue, so a held queue cannot hide what holds it.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'EVAL_DIRECT_DIAGNOSTICS' || !trustedUI(sender)) return;
  reply({ok: true, data: {events: evalEvents.slice(-1000), pendingToolOperations,
    inflight: [...evalInflight.values()].map(item => ({type: item.type, name: item.name, ms: Date.now() - item.at})).sort((left, right) => right.ms - left.ms).slice(0, 8)}});
});
`);
  report.diagnosticInstrumentation = 'Tool/schema codes, bounded review conclusions, redacted source URL/text hash/range coverage, value-free page-region counts, host semantic-click targets, bounded host script/semantic-input command receipts and model start/finish timestamps; no credentials, browser input values or request bodies';
  report.publicReadCapture = {enabled:publicReadPages.length>0,allowedPages:publicReadPages,scope:'Opt-in sanitized tool text on fixed public task pages; no authentication pages, arbitrary tool arguments, model request bodies or private reasoning'};
  } else {
    for (const key of ['scriptEvidenceInstrumentationSha256', 'diagnosticInstrumentation', 'publicReadCapture']) report[key] = attachment[key];
    for (const check of attachment.loadedBuild?.checks || []) {
      if (!/^[a-z0-9-]+\.js$/.test(check.file) || createHash('sha256').update(await readFile(resolve(extension,check.file))).digest('hex') !== check.expectedSha256) throw Error('evaluation_attachment_changed');
    }
    if (!attachment.loadedBuild?.verified || !attachment.loadedBuild.checks.length) throw Error('evaluation_attachment_unverified');
    report.attachedFromRunId = attachment.runId;
    report.attachmentMode = repeatRecorded ? 'new_trial_same_recorded_candidate' : freshAfterInterruption ? 'fresh_trial_after_harness_interruption' : 'continue_login_setup';
  }
  let port;
  if (attachment) {
    const pid = process.env.NUBI_EVAL_ATTACH_PID;
    if (!/^[1-9][0-9]*$/.test(pid || '')) throw Error('invalid_evaluation_pid');
    const {stdout} = await promisify(execFile)('ps', ['-p', pid, '-o', 'command=']);
    if (!stdout.includes(` --user-data-dir=${profile} `) || !stdout.includes(` --load-extension=${extension} `)) throw Error('evaluation_attachment_process_mismatch');
    port = Number(stdout.match(/ --remote-debugging-port=(\d+) /)?.[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid_evaluation_port');
  } else {
  port = await freePort();
  child = spawn(process.env.CHROME_BINARY || chromium.executablePath(), [
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
    '--no-first-run', '--lang=ko-KR', 'about:blank',
  ], {stdio: 'ignore'});
  }
  for (let attempt = 0; attempt < 100 && !browser; attempt++) {
    try {browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {timeout: 1000, ...(attachment ? {noDefaults:true} : {})});}
    catch {await new Promise(resolveDelay => setTimeout(resolveDelay, 200));}
  }
  if (!browser) throw new Error('evaluation_browser_unavailable');
  context = browser.contexts()[0];
  report.dialogObservations = [];
  observeEvaluationDialogs(context, report.dialogObservations);
  // Keep a live window while removing restored evaluation pages. Select only
  // this candidate's worker: an older disabled extension can be retiring here.
  const ui = await context.newPage();
  if (process.env.NUBI_EVAL_REUSE_PROFILE && !attachment) for (const page of context.pages()) if (page !== ui) await page.close();
  if (fixtures) {
    await mkdir(downloadsPath, {recursive: true});
    const downloadControl = await browser.newBrowserCDPSession();
    await downloadControl.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: downloadsPath});
    await downloadControl.detach();
  }
  let worker;
  for (let attempt = 0; attempt < 100 && !worker; attempt++) {
    for (const candidate of context.serviceWorkers()) {
      if (!candidate.url().endsWith('/background.js')) continue;
      if (await candidate.evaluate(() => chrome.runtime.getManifest().version_name).catch(() => null) === evaluationVersion) {worker = candidate; break;}
    }
    if (!worker) await new Promise(resolveDelay => setTimeout(resolveDelay, 200));
  }
  if (!worker) throw new Error('evaluation_extension_unavailable');
  const prepared = await prepareEvaluationBuild(browser, context, worker, extension);
  worker = prepared.worker;
  report.loadedBuild = prepared.verification;
  await save();
  const extensionUrl = `chrome-extension://${new URL(worker.url()).hostname}/index.html`;
  await ui.goto(extensionUrl);
  // A read that misses its deadline while the worker is busy is retried; the
  // count is reported so a slow worker stays visible instead of ending the run.
  report.readRetries = 0;
  const rpc = async message => {
    if (message.type === 'GET_EVAL_DIAGNOSTICS' && !attachment) {
      try {
        const direct = await waitForRead(() => ui.evaluate(() => chrome.runtime.sendMessage({type: 'EVAL_DIRECT_DIAGNOSTICS'})), {timeoutMs: 10000});
        if (Array.isArray(direct?.data?.events)) return {ok: true, data: direct.data.events};
      } catch (error) {if (error.message !== 'read_timeout') throw error;}
    }
    if (!message.type.startsWith('GET_')) return ui.evaluate(message => chrome.runtime.sendMessage(message), message);
    for (let attempt = 0; ; attempt++) {
      try {return await waitForRead(()=>ui.evaluate(message => chrome.runtime.sendMessage(message),message),{timeoutMs:10000});}
      catch (error) {
        if (error.message !== 'read_timeout') throw error;
        report.readRetries++;
        // Which side stalled: the page thread, the worker, or the message between them.
        const responds = async run => {const started = Date.now(); try {await waitForRead(run, {timeoutMs: 5000}); return Date.now() - started;} catch {return null;}};
        let inflight = null;
        try {inflight = (await waitForRead(() => ui.evaluate(() => chrome.runtime.sendMessage({type: 'EVAL_DIRECT_DIAGNOSTICS'})), {timeoutMs: 5000}))?.data;} catch { /* Recorded as null. */ }
        if ((report.readStalls ||= []).length < 24) report.readStalls.push({at: new Date().toISOString(), type: message.type, attempt,
          pageMs: await responds(() => ui.evaluate(() => 1)), workerMs: worker ? await responds(() => worker.evaluate(() => 1)) : null,
          pendingToolOperations: inflight?.pendingToolOperations ?? null, inflight: inflight?.inflight ?? null});
        // The product recovered by itself after such a stall: wait up to two minutes before giving up.
        if (attempt >= 11) throw error;
      }
    }
  };
  const state = async () => (await rpc({type: 'GET_STATE'})).data;
  const composer = evaluationComposer(ui);
  let ready=await state();
  if ((freshAfterInterruption || repeatRecorded) && ready.busy) throw Error('evaluation_previous_run_busy');
  if (repeatRecorded && (ready.chat?.task?.status === 'awaiting_user' || ready.chat?.messages?.at(-1)?.question)) throw Error('evaluation_previous_question_pending');
  if(!ready.auth?.present || ready.auth.provider!=='chatgpt' || ready.auth.rejected){
    report.status = 'awaiting_login'; await save();
    if (!ready.pending) await rpc({type: 'START_LOGIN', provider: 'chatgpt'});
    console.log(`LOGIN_REQUIRED: Complete ChatGPT SSO in the opened isolated Chrome window. Report: ${output}`);
  }
  const loginDeadline = Date.now() + loginTimeoutMs;
  while (Date.now() < loginDeadline) {
    ready = await state();
    if (ready.auth?.present && ready.auth.provider === 'chatgpt' && !ready.auth.rejected) break;
    if (!ready.pending && ready.report?.stage && !['login_opened', 'not_started'].includes(ready.report.stage)) break;
    await ui.waitForTimeout(500);
  }
  if (!ready?.auth?.present || ready.auth.provider !== 'chatgpt') {
    report.status = 'login_not_completed';
    report.loginStage = ready?.report?.stage || 'timeout';
    await save();
    console.log('NOT_RUN: ChatGPT SSO did not complete. No model score was produced.');
  } else {
    report.loginCompletedAt = new Date().toISOString();
    await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor({timeout: 30000});
    const catalogDeadline = Date.now() + 15000;
    while (Date.now() < catalogDeadline) {
      ready = await state();
      if (ready.catalog?.models?.some(item => item.name === model)) break;
      await ui.waitForTimeout(250);
    }
    if (!ready.catalog?.models?.some(item => item.name === model)) throw new Error('selected_model_missing_from_catalog');
    const selected = await rpc({type: 'SELECT_MODEL', name: model});
    if (selected?.data?.settings?.modelId !== model) throw new Error('selected_model_not_applied');
    report.status = 'running'; await save();
    const uiTabId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    // Knowledge probe: the same task runs without stored knowledge, with a site
    // document drafted from that run, and with a skill drafted from it (found
    // by the model, then selected by the user). Drafts are made and saved
    // through the product's own buttons. Measures the effect, not correctness.
    // NUBI_EVAL_KNOWLEDGE_PROBE names the task ids to probe; other tasks run once as usual.
    const probeIds = new Set((process.env.NUBI_EVAL_KNOWLEDGE_PROBE || '').split(',').map(id => id.trim()).filter(Boolean));
    const probe = probeIds.size ? knowledgeProbe({ui, rpc, state, report, save,
      keepText: (name, text) => /^[A-Z]-[0-9]{2}-(?:wiki|skill)\.md$/.test(name) ? writeFile(resolve(evidenceDirectory, name), String(text).slice(0, 60000)) : null}) : null;
    // Ordinary tasks run first: a probe drives more of the UI and is more likely to stop the run.
    const schedule = taskSet.slice(startIndex, startIndex + limit).flatMap(item => (probeIds.has(item.id) ? ['baseline', 'wiki', 'skill-auto', 'skill-selected'] : [null]).map(phase => ({item, phase})))
      .sort((left, right) => (left.phase ? 1 : 0) - (right.phase ? 1 : 0));
    for (const {item: selectedTask, phase} of schedule) {
      if (stopRequested) break;
      const task = {...selectedTask, startUrl: selectedTask.environment === 'local-fixture' ? fixtures.origin + selectedTask.startUrl : selectedTask.startUrl};
      const trialKey = phase && phase !== 'baseline' ? `${task.id}@${phase}` : task.id;
      if (probe && phase && !await probe.prepare(task, phase)) {
        report.trials.push({id: task.id, phase, status: 'not_run_knowledge_missing', startedAt: new Date().toISOString()}); await save();
        console.log(`${trialKey} not_run_knowledge_missing`);
        continue;
      }
      const trial = {id: task.id, ...(phase ? {phase} : {}), runId:report.runId, trialId:randomUUID(), domain: task.domain, goal: task.goal, expectedEvidence: task.outcomeEvidence,
        ...(suite30 ? {difficulty: task.difficulty, environment: task.environment, capabilities: task.capabilities, checks: task.checks, operator: task.operator} : {}),
        startUrl: task.startUrl, startedAt: new Date().toISOString(), model, provider: 'chatgpt',
        status: 'running', factualPass: null};
      report.trials.push(trial); await save();
      let source, lastDiagnosticSequence = 0;
      const checkpoint = async current => {
        const last=current.chat?.messages?.at(-1);
        const observed=((await rpc({type:'GET_EVAL_DIAGNOSTICS'}))?.data||[]).filter(event=>event.at>=Date.parse(trial.startedAt)&&event.sequence>lastDiagnosticSequence);
        const rows=observed.map(event=>({runId:report.runId,trialId:trial.trialId,taskId:task.id,...event}));
        if(observed.length)lastDiagnosticSequence=observed.at(-1).sequence;
        rows.push({runId:report.runId,trialId:trial.trialId,taskId:task.id,kind:'checkpoint',at:Date.now(),modelRequests:modelRequests.size,
          taskStatus:current.chat?.task?.status,modelId:last?.modelId,answerCharacters:last?.content?.length||0,plan:current.chat?.task?.plan||[]});
        await appendFile(resolve(evidenceDirectory,trialKey+'.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
        trial.lastCheckpointAt=new Date().toISOString();await save();
      };
      const modelRequests = new Set(), modelStarted = new Map(), modelDurations = [], modelFirstResponse = [];
      const responseChecks = new Set();
      let modelValidResponses = 0;
      let modelHttp200 = 0, modelHttpErrors = 0;
      const isModel = request => {
        try {const url = new URL(request.url()); return request.method() === 'POST' &&
          url.origin === 'https://chatgpt.com' && url.pathname.endsWith('/codex/responses');}
        catch {return false;}
      };
      const onRequest = request => {if (isModel(request)) {modelRequests.add(request); modelStarted.set(request, Date.now());}};
      const onResponse = response => {
        if (!modelRequests.has(response.request())) return;
        const started = modelStarted.get(response.request());
        if (started !== undefined) modelFirstResponse.push(Date.now() - started);
        if (response.status() === 200) modelHttp200++; else modelHttpErrors++;
      };
      const onRequestFinished = request => {
        const started = modelStarted.get(request);
        if (started !== undefined) modelDurations.push(Date.now() - started);
        modelStarted.delete(request);
        if (modelRequests.has(request)) {
          const check = (async () => {
            let timer;
            try {
              const response = await request.response();
              if (response?.status() !== 200) return;
              const body = await Promise.race([response.text(), new Promise(resolve => {timer = setTimeout(() => resolve(''), 5000);})]);
              if (hasResponsesOutput(body)) modelValidResponses++;
            } catch {} finally {clearTimeout(timer);}
          })();
          responseChecks.add(check); check.finally(() => responseChecks.delete(check));
        }
      };
      context.on('request', onRequest); context.on('response', onResponse); context.on('requestfinished', onRequestFinished);
      try {
        if ((freshAfterInterruption || repeatRecorded) && (await state()).busy) throw Error('evaluation_previous_run_busy');
        const reset = await prepareEvaluationTrial({state, rpc, wait: ms => ui.waitForTimeout(ms),
          waitForUI: sessionId => waitForEvaluationUI({composer, state, sessionId, wait: ms => ui.waitForTimeout(ms)}),
          stop: freshAfterInterruption || repeatRecorded ? undefined : () => ui.getByRole('button', {name: '중지', exact: true}).click()});
        const previousTabIds = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id));
        source = await context.newPage();
        // A dropped connection before the task starts is a network fault, not a
        // product result. Reload the start page up to three times, then fail.
        let initial, startAttempts = 0;
        for (;;) {
          try {startAttempts++; initial = await source.goto(task.startUrl, {waitUntil: 'domcontentloaded', timeout: 30000}); break;}
          catch (error) {
            if (startAttempts >= 3 || !/net::ERR_(CONNECTION_|NETWORK_CHANGED|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|TIMED_OUT|EMPTY_RESPONSE|HTTP2_)/.test(String(error?.message))) throw error;
            await source.waitForTimeout(3000 * startAttempts);
          }
        }
        if (startAttempts > 1) trial.startAttempts = startAttempts;
        trial.initialHttpStatus = initial?.status() || null;
        const sourceTabId = await worker.evaluate(async ({url, previousTabIds}) => {
          const fresh = (await chrome.tabs.query({})).filter(tab => !previousTabIds.includes(tab.id) && tab.url === url);
          if (fresh.length !== 1) throw Error('evaluation_source_ambiguous');
          return fresh[0].id;
        }, {url: source.url(), previousTabIds});
        if (!sourceTabId) throw new Error('source_tab_missing');
        await worker.evaluate(({uiTabId, sourceTabId}) => chrome.storage.session.set({chatSourceTabs: {[uiTabId]: sourceTabId}}), {uiTabId, sourceTabId});
        await source.bringToFront();
        const connection = await rpc({type:'CONNECT_PAGE'});
        const connectedTabId = await worker.evaluate(async () => (await chrome.storage.session.get('page')).page?.tabId);
        if (connection?.error || connectedTabId !== sourceTabId) throw Error('evaluation_source_connection_mismatch');
        trial.sourceBinding = {tabId:sourceTabId, connectedTabId, uniqueNewTab:true};
        if (task.setup === 'fixture-attachment') {
          await ui.getByLabel('첨부 파일 선택', {exact: true}).setInputFiles({name: 'training.txt', mimeType: 'text/plain', buffer: Buffer.from(trainingText)});
          const until = Date.now() + 15000;
          let attachmentReady = false;
          while (Date.now() < until) {
            if ((await state()).chat?.draftAttachments?.some(file => file.name === 'training.txt' && file.bytes === Buffer.byteLength(trainingText))) {attachmentReady = true; break;}
            await ui.waitForTimeout(200);
          }
          if (!attachmentReady) throw new Error('fixture_attachment_setup_failed');
          trial.setup = {kind: task.setup, bytes: Buffer.byteLength(trainingText), sha256: createHash('sha256').update(trainingText).digest('hex')};
        }
        trial.submission = await submitEvaluationTask({composer, state, sessionId: reset.chat.sessionId, wait: ms => ui.waitForTimeout(ms),
          text: `${task.goal}\n\n${task.readOnly !== false ? '읽기 전용으로 조사해 주세요. 확인한 출처 URL과 열람 범위, 확인하지 못한 부분을 구분해 주세요.' : '연결된 로컬 평가 페이지에서만 작업하세요. 요청하지 않은 등록/제출은 하지 마세요.'}`});
        // Evaluation budget only; this does not alter the product's user-wait policy.
        const effectiveTimeoutMs = process.env.NUBI_EVAL_TRIAL_TIMEOUT_MS ? trialTimeoutMs : suite30 ? {easy:180000,medium:300000,hard:480000}[task.difficulty] : trialTimeoutMs;
        trial.evaluationBudget = {timeoutMs:effectiveTimeoutMs,idleTimeoutMs,maxModelRequests};
        let deadline = Date.now() + effectiveTimeoutMs;
        let current, lastProgressAt = Date.now(), progress = '';
        while (!stopRequested && Date.now() < deadline && Date.now() - lastProgressAt < idleTimeoutMs && modelRequests.size < maxModelRequests) {
          current = await state();
          const last = current.chat?.messages?.at(-1);
          trial.planTransitions ||= [];
          const currentPlan = current.chat?.task?.plan || [];
          const planKey = JSON.stringify(currentPlan);
          const planChanged=trial.planTransitions.at(-1)?.key!==planKey;
          if (planChanged) trial.planTransitions.push({at: new Date().toISOString(), key: planKey,plan:structuredClone(currentPlan)});
          const nextProgress = `${modelRequests.size}:${last?.trace?.length || 0}:${last?.content?.length || 0}`;
          if (nextProgress !== progress || planChanged) {progress = nextProgress; lastProgressAt = Date.now();await checkpoint(current);}
          if (fixtureApprovals && !current.busy && current.chat?.task?.status === 'awaiting_user' &&
              !trial.transferApproval && last?.question?.kind === 'approval') {
            const record = await worker.evaluate(async id => {
              const {actionApprovals} = await chrome.storage.session.get('actionApprovals');
              const r = actionApprovals?.[id];
              if (!r) return null;
              const tab = await chrome.tabs.get(r.tabId);
              return {questionId:r.questionId,conversationId:r.conversationId,operation:r.operation,action:r.action,pageUrl:tab.url};
            }, current.chat.sessionId);
            // A run of public tasks starts no fixture server; their approvals are never answered here.
            if (fixtureApprovalAllowed({enabled:true,taskId:task.id,origin:fixtures?.origin,question:last.question,
              record,conversationId:current.chat.sessionId,pageUrl:record?.pageUrl})) {
              await ui.locator('.action-approval[data-answered="false"]').getByRole('button',{name:last.question.buttonLabel,exact:true}).click();
              trial.transferApproval={questionId:last.question.id,messageId:last.id,method:record.operation.method,at:new Date().toISOString(),scope:'frozen_local_fixture_only'};
              lastProgressAt=Date.now();await save();continue;
            }
          }
          if (trial.transferApproval && last?.id === trial.transferApproval.messageId) {await ui.waitForTimeout(100);continue;}
          if (task.id === 'H-10' && current.chat?.task?.status === 'awaiting_user' && !trial.operatorEvidence && ['text','choice'].includes(last?.question?.kind)) {
            const questionId=last.question.id, sessionId=current.chat.sessionId;
            const binding={conversationId:sessionId,sourceTabId,mode:current.browserWorkMode,origin:fixtures.origin};
            const before=await inspectEvaluationTarget(worker,binding), beforeCalls=modelRequests.size, waitStart=Date.now();
            const checks=[];
            while(Date.now()-waitStart<180000 && !stopRequested) {
              await ui.waitForTimeout(Math.min(1000,180000-(Date.now()-waitStart)));
              const waiting=await state();
              const page=await inspectEvaluationTarget(worker,binding);
              checks.push(waiting.chat?.sessionId===sessionId && waiting.chat?.task?.status==='awaiting_user' &&
                waiting.chat.messages.at(-1)?.question?.id===questionId && modelRequests.size===beforeCalls &&
                JSON.stringify(page.observed)===JSON.stringify(before.observed));
              if(!checks.at(-1))break;
            }
            const waitedMs=Date.now()-waitStart;
            trial.operatorEvidence={questionId,sessionId,waitedMs,stable:checks.every(Boolean)&&waitedMs>=180000,before};
            deadline+=waitedMs; lastProgressAt=Date.now();
            if(!trial.operatorEvidence.stable)break;
            const card=ui.locator('.question-card[data-answered="false"]').last();
            await card.getByRole('textbox',{name:'직접 답변',exact:true}).fill('개발팀');
            await card.getByRole('button',{name:'답변 보내기',exact:true}).click();
            trial.operatorEvidence.answerSentAt=new Date().toISOString();
            await save(); continue;
          }
          // A click resolves before React/worker publishes the next assistant.
          // Do not mistake the old answered question or prior final message for
          // the completion of the newly sent answer/correction.
          if (task.id === 'H-10' && trial.operatorEvidence?.answerSentAt &&
            (last?.question?.id === trial.operatorEvidence.questionId ||
              trial.operatorEvidence.correctionSentAt && last?.id === trial.operatorEvidence.correctionAfterMessageId)) {
            await ui.waitForTimeout(100); continue;
          }
          if (task.id === 'H-10' && !current.busy && last?.state==='done' && !last.question && current.chat?.task?.status==='done' && trial.operatorEvidence?.answerSentAt && !trial.operatorEvidence.correctionSentAt) {
            const binding={conversationId:current.chat.sessionId,sourceTabId,mode:current.browserWorkMode,origin:fixtures.origin};
            trial.operatorEvidence.afterAnswer=await inspectEvaluationTarget(worker,binding);
            if(trial.operatorEvidence.afterAnswer.observed.team!=='개발팀')break;
            await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('담당 팀만 운영팀으로 바꿔 줘. 기존 제목과 메모는 유지하고 등록하지 마.');
            await ui.getByRole('button',{name:'전송',exact:true}).click();
            trial.operatorEvidence.correctionAfterMessageId=last.id;
            trial.operatorEvidence.correctionSentAt=new Date().toISOString();
            await save(); continue;
          }
          if (last?.role === 'assistant' && ['done', 'error'].includes(last.state) || current.chat?.task?.status === 'awaiting_user') break;
          await ui.waitForTimeout(500);
        }
        current ||= await state();
        const last = current.chat?.messages?.at(-1) || {};
        trial.status = current.chat?.task?.status === 'awaiting_user' ? 'awaiting_user' :
          last.state === 'done' ? 'answered' : last.state === 'error' ? 'agent_error' : 'timeout';
        trial.answer = (last.content || '').slice(0, 50000);
        await checkpoint(current);
        await save();
        // Freeze an overdue run before collecting diagnostics. Observability
        // must not keep an already failed model task running indefinitely.
        if(trial.status==='timeout' && current.busy){
          await ui.getByRole('button',{name:'중지',exact:true}).click({timeout:5000});
          for(let i=0;i<40;i++){if(!(await state()).busy)break;await ui.waitForTimeout(250);}
          trial.stopConfirmed=!(await state()).busy;
        }
        trial.agentError = last.error || null;
        trial.captures = (last.captures || []).map(({id, source, host, width, height, bytes, capturedAt, traceId}) =>
          ({id, source, host, width, height, bytes, capturedAt, traceId}));
        trial.captureError = last.captureError || null;
        trial.question = last.question?.text || null;
        if (task.operator && trial.status === 'awaiting_user') trial.operatorStatus = 'waiting_and_followup_not_tested';
        trial.agentModelId = last.modelId || null;
        trial.taskReview = current.chat?.task?.goalReview?.status || null;
        trial.taskReviewFailureReason = current.chat?.task?.goalReview?.reason || null;
        trial.trace = (last.trace || []).map(step => ({tool: step.tool || step.name, status: step.status, label: step.label})).slice(0, 150);
        if (current.chat?.sessionId && last.id) {
          const events = [];
          let before;
          for (let pageIndex = 0; pageIndex < 6; pageIndex++) {
            const page = (await rpc({type: 'GET_TRACE_JOURNAL', provider: 'chatgpt',
              conversationId: current.chat.sessionId, requestId: last.id, ...(before ? {before} : {})}).catch(() => null))?.data;
            if (!page?.available) break;
            events.push(...(page.events || []).map(({sequence, at, id, tool, status, analysis}) =>
              ({sequence, at, id, tool, status, ...(analysis ? {analysis} : {})})));
            if (!page.next || events.length >= 300) break;
            before = page.next;
          }
          trial.traceTimeline = events.toSorted((a, b) => a.sequence - b.sequence).slice(-300);
          const diagnostics = [];
          before = undefined;
          for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
            const page = (await rpc({type: 'GET_AGENT_DIAGNOSTICS', provider: 'chatgpt',
              conversationId: current.chat.sessionId, requestId: last.id, ...(before ? {before} : {})}).catch(() => null))?.data;
            if (!page?.available) break;
            diagnostics.push(...page.events);
            trial.diagnosticRetention = {retained: page.retained, dropped: page.dropped, missing: page.missing};
            if (!page.next) break;
            before = page.next;
          }
          trial.agentDiagnostics = diagnostics.toSorted((a, b) => a.sequence - b.sequence);
        }
        trial.authVerified = !!current.auth?.verifiedAt;
        trial.plan = current.chat?.task?.plan || last.progress?.plan || null;
        const deliveryArgs={conversationId:current.chat.sessionId,requestId:last.id};
        const rendered=trial.status==='answered'
          ? await waitForEvaluationDelivery({ui,...deliveryArgs,planLength:trial.plan?.length||0,...(resultHoldMs?{timeoutMs:15000}:{})})
          : await ui.evaluate(inspectEvaluationDelivery,deliveryArgs);
        trial.delivery={taskStatus:current.chat?.task?.status||null,busy:!!current.busy,...rendered,
          answerVisible:trial.status==='answered' && rendered.answerVisible && rendered.conversationMatches && rendered.requestMatches};
        trial.diagnostics = ((await rpc({type:'GET_EVAL_DIAGNOSTICS'}))?.data || []).filter(event => event.at >= Date.parse(trial.startedAt));
        trial.sourceFinalUrl = source.url();
        if (suite30) {
          const binding = await waitForRead(()=>worker.evaluate(async id => {
            const {browserContexts, browserWorkspaces, credential} = await chrome.storage.session.get(['browserContexts', 'browserWorkspaces', 'credential']);
            return {record: browserContexts?.[id], workspace: browserWorkspaces?.[id], credential: credential ? {provider: credential.provider || 'aipro', receivedAt: credential.receivedAt} : null};
          }, current.chat.sessionId),{timeoutMs:10000});
          const target = evaluationTarget(binding, {conversationId: current.chat.sessionId, sourceTabId, mode: current.browserWorkMode});
          trial.target = target;
          trial.targetPage = await waitForRead(()=>worker.evaluate(async tabId => {
            const tab = await chrome.tabs.get(tabId);
            return {url: tab.url, title: tab.title};
          }, target.tabId),{timeoutMs:10000});
          trial.workspacePresentation = await worker.evaluate(async ids => {
            const tabs = (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id));
            return {tabCount:tabs.length, groupIds:[...new Set(tabs.map(tab=>tab.groupId).filter(id=>id>=0))]};
          }, Object.values(binding.workspace ? {current:binding.workspace} : {}).flatMap(w=>w.tabIds||[]));
          if (task.environment === 'public-live') {
            trial.pageEvidence = await worker.evaluate(async ids => {
              const evidence=[];
              for (const tabId of ids.slice(-8)) {
                try {
                  const tab=await chrome.tabs.get(tabId);
                  if (!/^https?:/.test(tab.url||'')) continue;
                  const frames=await chrome.scripting.executeScript({target:{tabId},func:()=>({url:location.href,title:document.title,
                    text:document.body?.innerText.slice(0,50000),
                    links:Array.from(document.querySelectorAll('a[href]')).filter(a=>a.innerText.trim()).slice(0,200).map(a=>({text:a.innerText.slice(0,180),url:a.href})),
                    video:Array.from(document.querySelectorAll('video')).map(v=>({duration:Number.isFinite(v.duration)?v.duration:null})),observedAt:new Date().toISOString()})});
                  evidence.push({tabId,frames:frames.map(({documentId,result})=>({documentId,...result}))});
                } catch {evidence.push({tabId,error:'evidence_unavailable'});}
              }
              return evidence;
            }, binding.workspace?.tabIds || [target.tabId]);
          }
          if (task.environment === 'local-fixture') {
            if (new URL(trial.targetPage.url).origin !== fixtures.origin) throw new Error('evaluation_fixture_target_changed');
            trial.fixtureState = await worker.evaluate(async tabId => (await chrome.scripting.executeScript({target: {tabId, allFrames: true}, world: 'MAIN', func: () => ({
              url: location.href, fields: Array.from(document.querySelectorAll('input,textarea,select')).map(el => ({id: el.id, label: el.labels?.[0]?.textContent, value: el.type === 'file' ? undefined : el.value, files: el.type === 'file' ? Array.from(el.files).map(file => ({name: file.name, size: file.size})) : undefined})),
              counters: window.evalCounters, pages: window.visitedPages, queries: window.queries, duplicates: window.duplicateQueries,
              toggle: document.querySelector('#toggle')?.getAttribute('aria-checked'), modalOpen: !!document.querySelector('dialog[open]'), result: document.querySelector('output')?.textContent,
            })})).map(({frameId, documentId, result}) => ({frameId, documentId, ...result})), target.tabId);
            if (task.id === 'H-08') {
              trial.downloadCollection = await worker.evaluate(() => ({available: typeof chrome.downloads?.search === 'function'}));
              const downloads = trial.downloadCollection.available ? await worker.evaluate(async ({url, startedAfter}) => (await chrome.downloads.search({startedAfter})).filter(item => item.url === url).map(({state, filename, bytesReceived, totalBytes, error}) => ({state, filename, bytesReceived, totalBytes, error})), {url: fixtures.origin + '/training.txt', startedAfter: trial.startedAt}) : [];
              trial.downloads = await Promise.all(downloads.map(async download => ({state: download.state, filename:basename(download.filename), bytesReceived: download.bytesReceived, totalBytes: download.totalBytes, error: download.error,
                sha256: download.state === 'complete' && dirname(download.filename) === downloadsPath ? await readFile(download.filename).then(bytes => createHash('sha256').update(bytes).digest('hex')).catch(() => null) : null})));
            }
          }
        }
        trial.diagnostics = ((await rpc({type:'GET_EVAL_DIAGNOSTICS'}))?.data || []).filter(event => event.at >= Date.parse(trial.startedAt));
        trial.modelExecutionTiming = modelExecutionTiming(trial.diagnostics);
        await ui.screenshot({path:output.replace('.json', `-${trialKey}.png`),animations:'disabled',timeout:10000}).catch(()=>{});
      } catch (error) {
        trial.outcomeBeforeCollectionError = trial.status;
        trial.status = 'runner_error'; trial.error = String(error.message).slice(0, 200);
        if (error.submissionDiagnostics) trial.submissionFailure = error.submissionDiagnostics;
        if (error.reason) trial.bindingFailure = error.reason;
        await ui.screenshot({path:output.replace('.json', `-${trialKey}-error.png`),animations:'disabled',timeout:5000}).catch(()=>{});
      } finally {
        context.off('request', onRequest); context.off('response', onResponse); context.off('requestfinished', onRequestFinished);
        await Promise.all([...responseChecks]);
        trial.modelRequests = modelRequests.size;
        trial.modelHttp200 = modelHttp200;
        trial.modelHttpErrors = modelHttpErrors;
        trial.modelValidResponses = modelValidResponses;
        const orderedDurations = modelDurations.toSorted((a, b) => a - b);
        const orderedFirstResponse = modelFirstResponse.toSorted((a, b) => a - b);
        trial.modelTiming = {completed: orderedDurations.length,
          totalMs: modelDurations.reduce((sum, duration) => sum + duration, 0),
          medianMs: orderedDurations.length ? orderedDurations[Math.floor(orderedDurations.length / 2)] : null,
          p95Ms: orderedDurations.length ? orderedDurations[Math.ceil(orderedDurations.length * .95) - 1] : null,
          firstResponseCount: orderedFirstResponse.length,
          firstResponseMedianMs: orderedFirstResponse.length ? orderedFirstResponse[Math.floor(orderedFirstResponse.length / 2)] : null,
          firstResponseP95Ms: orderedFirstResponse.length ? orderedFirstResponse[Math.ceil(orderedFirstResponse.length * .95) - 1] : null};
        trial.actualModel = modelRequests.size > 0 && modelValidResponses > 0 && trial.agentModelId === model;
        report.actualModel ||= trial.actualModel;
        trial.finishedAt = new Date().toISOString();
        trial.responseEvidence = parsedReviewEvidence(trial, model);
        if (trial.responseEvidence.verified) {
          trial.actualModel = true;
          trial.transportValidResponses = modelValidResponses;
          trial.modelValidResponses = Math.max(modelValidResponses, trial.responseEvidence.verifiedResponsesLowerBound);
          report.actualModel = true;
        }
        trial.elapsedMs = Date.parse(trial.finishedAt) - Date.parse(trial.startedAt);
        if (suite30 && !probe) report.progress = browserScore(selectedTasks, report.trials, [], {targetRate}).total;
        report.completedTrials = report.trials.filter(item => item.status !== 'running' && !item.status.startsWith('not_run')).length;
        if (resultHoldMs && trial.status !== 'runner_error') {
          await ui.bringToFront().catch(() => {});
          await ui.waitForTimeout(resultHoldMs);
          trial.resultHold = {ms: resultHoldMs, afterFinishedAt: true, answerVisible: trial.delivery?.answerVisible === true, renderSettled: trial.delivery?.renderSettled === true};
        }
        if (trial.status !== 'runner_error') await source?.close().catch(() => {});
        await save();
        await writeFile(resolve(evidenceDirectory,trialKey+'.json'),JSON.stringify(trial,null,2));
        if (probe && phase && trial.status !== 'runner_error') await probe.after(task, phase, trial).catch(error => {trial.probeError = String(error?.message).slice(0, 200);});
        if (probe) await save();
        console.log(`${trialKey} ${trial.status} model=${trial.actualModel} calls=${trial.modelRequests}${report.progress ? ` evaluated=${report.progress.completed}/${report.progress.planned} (${(report.progress.executionCompletionRate * 100).toFixed(1)}%) quality=independent-grading-required` : ''}`);
      }
      if (trial.status === 'runner_error' || (trial.status === 'timeout' && !trial.stopConfirmed)) break;
    }
    report.recordedTasks = report.trials.filter(item => item.status !== 'running').length;
    report.status = probe ? (report.recordedTasks === schedule.length ? 'probe_recorded' : 'interrupted')
      : report.completedTrials === limit ? 'trials_recorded' : report.recordedTasks === limit ? 'partial_operator_required' : 'interrupted';
  }
} catch (error) {
  report.status = 'setup_error'; report.error = String(error.message).slice(0, 200);
  console.error(`SETUP_ERROR ${report.error}`);
} finally {
  report.finishedAt = new Date().toISOString();
  await save();
  // Keep the exact failed screen and session available for inspection. Never
  // restart the agent or replay a write merely to keep the browser visible.
  if (attachment && browser?.isConnected()) {report.browserDisposition = 'preserved_for_inspection'; await save();}
  const preserve = browser?.isConnected() && child && child.exitCode === null &&
    (process.env.NUBI_EVAL_KEEP_BROWSER === '1' || ['interrupted', 'setup_error', 'login_not_completed', 'partial_operator_required'].includes(report.status));
  if (preserve) {
    report.browserDisposition = 'preserved_for_inspection';
    await save();
    console.log(`BROWSER_PRESERVED: Evaluation stopped; close the evaluation browser after inspection. Report: ${output}`);
    await once(child, 'exit');
    report.browserDisposition = 'closed_after_inspection';
    await save();
  }
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([once(child, 'exit'), new Promise(resolveDelay => setTimeout(resolveDelay, 5000))]);
  }
  if(!process.env.NUBI_EVAL_REUSE_PROFILE && process.env.NUBI_EVAL_KEEP_PROFILE!=='1')await rm(profile, {recursive: true, force: true}).catch(() => {});
  await fixtures?.close();
  console.log(output);
}
