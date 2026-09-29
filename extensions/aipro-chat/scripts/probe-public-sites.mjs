// Live public-site reachability through the packaged Nubi read_page tool.
// This deliberately does not assign an autonomous task-completion score.
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicSiteTasks} from '../evaluation/public-sites-50.mjs';
import {naverTasks} from '../evaluation/naver-50.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const chromeBinary = process.env.CHROME_BINARY;
if (!chromeBinary) throw new Error('Set CHROME_BINARY to the tested Chrome binary');
const taskSet = process.env.NUBI_PUBLIC_SITE_SET === 'naver' ? 'naver' : 'google-youtube';
const tasks = taskSet === 'naver' ? naverTasks : publicSiteTasks;
const output = resolve('verification', `${taskSet}-sites-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(output, {recursive: true});
const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
await writeFile(resolve(output, 'TASKS.md'), `# ${taskSet === 'naver' ? 'Naver' : 'Google·YouTube'} 공개 사이트 과제 50개\n\n` +
  '| ID | 영역 | 목표 | 독립 판정 근거 |\n| --- | --- | --- | --- |\n' +
  tasks.map(task => `| ${cell(task.id)} | ${cell(task.domain || task.topic)} | ${cell(task.goal)} | ${cell(task.outcomeEvidence)} |`).join('\n') + '\n');
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-public-sites-'));
const extension = resolve(profile, 'extension');
const report = {startedAt: new Date().toISOString(), status: 'running', actualBrowser: true,
  actualPublicSites: true, actualNubiReadPage: false, actualModel: false,
  taskSet, taskCount: tasks.length, taskCompletionScore: null, taskCompletionStatus: 'unscored_no_model', probes: [], tasks: []};
let context;
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  // Only the isolated test copy receives these host permissions.
  manifest.host_permissions.push(...(taskSet === 'naver'
    ? ['https://search.naver.com/*', 'https://www.naver.com/*']
    : ['https://www.google.com/*', 'https://www.youtube.com/*']));
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  const background = resolve(extension, 'background.js');
  await writeFile(background, `${await readFile(background, 'utf8')}\nglobalThis.publicSiteProbe={runBrowserAgent,stopBrowserAgent};\n`);
  context = await chromium.launchPersistentContext(profile, {headless: true, locale: 'ko-KR', executablePath: chromeBinary,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const urls = [...new Set(tasks.map(task => task.startUrl))];
  let googleBlocked = false, captureSaved = false;
  for (const [index, url] of urls.entries()) {
    const site = taskSet === 'naver' ? 'naver' : new URL(url).hostname === 'www.google.com' ? 'google' : 'youtube';
    if (site === 'google' && googleBlocked) {
      report.probes.push({url, site, status: 'skipped_after_origin_block'});
      continue;
    }
    const id = `public-${index}`;
    let page;
    try {
      page = await context.newPage();
      const response = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 25000});
      await page.waitForFunction(() => (document.body?.innerText || '').length > 150, undefined, {timeout: 10000}).catch(() => {});
      // YouTube search hydrates after DOMContentLoaded; use a bounded wait,
      // then record missing content rather than inventing search results.
      if (site === 'youtube') await page.waitForTimeout(3500);
      if (site === 'naver') await page.waitForTimeout(1200);
      const tabId = await worker.evaluate(async currentUrl => (await chrome.tabs.query({})).find(tab => tab.url === currentUrl)?.id, page.url());
      if (!tabId) throw new Error('probe_tab_missing');
      const {result} = await worker.evaluate(async ({id, tabId}) => publicSiteProbe.runBrowserAgent(id, {tabId}, 'read_page', {}, {vision: false}), {id, tabId});
      const text = (result?.frames || []).map(frame => frame.text || '').join('\n');
      const challenge = /비정상적인 트래픽|not a robot|unusual traffic|confirm.*not a bot|captcha/i.test(text);
      const status = challenge ? 'blocked_challenge' : result?.error ? 'nubi_read_error' : text.length < 200 ? 'content_unavailable' : 'initial_page_ready';
      if (site === 'google' && challenge) googleBlocked = true;
      if (result?.frames?.length) report.actualNubiReadPage = true;
      const probe = {url, observedUrl: page.url(), site, httpStatus: response?.status(), title: (await page.title()).slice(0, 180),
        status, frameCount: result?.frames?.length || 0, visibleTextLength: text.length,
        visibleTextSha256: createHash('sha256').update(text).digest('hex'),
        frameCoverage: result?.frameCoverage,
        partialFrames: (result?.frames || []).filter(frame => frame.truncated || frame.unavailable || frame.coverage?.domTruncated || frame.coverage?.textTruncated)
          .map(frame => ({frame: frame.frame, unavailable: !!frame.unavailable, truncated: !!frame.truncated,
            nodesInspected: frame.coverage?.nodesInspected, nodeLimit: frame.coverage?.nodeLimit,
            omittedControls: frame.omittedControls || 0})),
        ...(result?.error ? {toolError: result.error} : {})};
      if (status === 'initial_page_ready' && !captureSaved) {
        const capture = await worker.evaluate(async ({id, tabId}) => publicSiteProbe.runBrowserAgent(id, {tabId}, 'capture_page', {full_page: false}, {vision: true}), {id, tabId});
        if (capture?.result?.image?.data) {
          const imagePath = resolve(output, `${site}-nubi-capture.png`);
          await writeFile(imagePath, Buffer.from(capture.result.image.data, 'base64'));
          probe.nubiCapture = imagePath;
          captureSaved = true;
        } else probe.captureStatus = capture?.result?.error || 'no_image';
      }
      report.probes.push(probe);
      console.log(`${status.toUpperCase()} ${site} ${new URL(url).searchParams.values().next().value || ''}`);
    } catch (error) {
      report.probes.push({url, site, status: 'probe_error', error: String(error.message).slice(0, 180)});
      console.log(`PROBE_ERROR ${site}`);
    } finally {
      await worker.evaluate(id => publicSiteProbe.stopBrowserAgent(id), id).catch(() => {});
      await page?.close().catch(() => {});
    }
  }
  const byUrl = new Map(report.probes.map(probe => [probe.url, probe]));
  report.tasks = tasks.map(({id, topic, domain, pattern, site, startUrl, goal, outcomeEvidence}) => ({
    id, ...(topic ? {topic} : {}), ...(domain ? {domain} : {}), ...(pattern ? {pattern} : {}), site, goal, outcomeEvidence, startUrl,
    initialPageStatus: byUrl.get(startUrl)?.status || 'not_probed', completion: 'unscored_no_model',
  }));
  report.status = report.probes.some(probe => probe.status === 'probe_error') ? 'partial' : 'completed';
} catch (error) {
  report.status = 'failed'; report.error = String(error.message).slice(0, 200); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await context?.close();
  await rm(profile, {recursive: true, force: true});
  console.log(resolve(output, 'report.json'));
}
