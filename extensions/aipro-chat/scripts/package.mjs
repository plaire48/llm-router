import {copyFile, cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {basename, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {wikiBrowserBuild} from './wiki-browser-build.mjs';
import {helpMarkdown} from '../help-content.js';
import {copyDocumentLicenses} from './document-licenses.mjs';
import {releaseInfo} from './release-info.mjs';
import {PAGE_BUILTINS} from './page-builtins.mjs';

const root = process.cwd();
await mkdir('dist/licenses',{recursive:true});
for (const [name,file] of [['buffer','LICENSE'],['base64-js','LICENSE'],['ieee754','LICENSE']]) await copyFile(`node_modules/${name}/${file}`,`dist/licenses/${name}-LICENSE`);
const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
const project = JSON.parse(await readFile('package.json', 'utf8'));
const release = releaseInfo(manifest, project);
const mainHTML = await readFile('dist/index.html', 'utf8');
const sharedCSS = mainHTML.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/)?.[1];
if (!sharedCSS) throw new Error('Shared CX styles are required for the login callback');
const callbackHTML = await readFile('public/auth-return.html', 'utf8');
await writeFile('dist/auth-return.html', callbackHTML.replace('<!-- cx-styles -->', `<link rel="stylesheet" href="${sharedCSS}">`));
await writeFile('dist/build-info.json', JSON.stringify({...release, agent: {package: '@earendil-works/pi-agent-core', version: project.dependencies['@earendil-works/pi-agent-core']}, browser: {package: '@playwright-repl/playwright-crx', version: project.dependencies['@playwright-repl/playwright-crx']}, sandbox: {package: 'quickjs-emscripten-core', version: project.dependencies['quickjs-emscripten-core']}}, null, 2) + '\n');
await build({entryPoints: ['background-runner.js'], outfile: 'dist/background-runner.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome125', minify: true,
  ...wikiBrowserBuild});
await copyFile('openwiki-contract.js', 'dist/openwiki-contract.js');
await copyFile('read-deadline.js', 'dist/read-deadline.js');
await copyFile('background-images.js', 'dist/background-images.js');
await build({entryPoints:['trace-journal.js'],outfile:'dist/trace-journal.js',bundle:true,platform:'browser',format:'esm',target:'chrome125',minify:true});
await build({entryPoints:['agent-diagnostic-journal.js'],outfile:'dist/agent-diagnostic-journal.js',bundle:true,platform:'browser',format:'esm',target:'chrome125',minify:true});
await build({entryPoints: ['image-renderer.js'], outfile: 'dist/image-renderer.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome125', minify: true});
await build({entryPoints: ['browser-document-worker.js'], outfile: 'dist/browser-document-worker.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome125', minify: true});
await build({entryPoints:['mcp-client.js'], outfile:'dist/mcp-client.js',bundle:true,platform:'browser',format:'esm',target:'chrome125',minify:true});
await copyFile('plan-mode.js', 'dist/plan-mode.js');
await copyFile('document-contract.js', 'dist/document-contract.js');
await copyFile('browser-knowledge.js', 'dist/browser-knowledge.js');
// The parser's named-entity decoder exposes a DOM-free worker export. A
// service worker has no document; the default browser export cannot run here.
await build({entryPoints: ['site-wiki-retrieval.js'], outfile: 'dist/site-wiki-retrieval.js', bundle: true, platform: 'browser', conditions: ['worker'], external: ['./evidence-search.js'], format: 'esm', target: 'chrome125', minify: true});
await copyFile('core.js', 'dist/core.js');
await copyFile('agent-inbox.js', 'dist/agent-inbox.js');
await copyFile('mcp-config.js', 'dist/mcp-config.js');
await copyFile('voc-tools.js', 'dist/voc-tools.js');
await copyFile('voc-page.js', 'dist/voc-page.js');
await build({entryPoints:['voc-workspace.js'],outfile:'dist/voc-workspace.js',bundle:true,platform:'browser',format:'esm',target:'chrome125',minify:true});
await copyFile('completion-errors.js', 'dist/completion-errors.js');
await copyFile('http-retry.js', 'dist/http-retry.js');
await copyFile('model-routing.js', 'dist/model-routing.js');
await copyFile('conversations.js', 'dist/conversations.js');
await copyFile('provider-sessions.js', 'dist/provider-sessions.js');
await copyFile('callback.js', 'dist/callback.js');
await copyFile('exchange.js', 'dist/exchange.js');
await copyFile('chatgpt-auth.js', 'dist/chatgpt-auth.js');
await copyFile('fabrix.js', 'dist/fabrix.js');
await copyFile('login-redirect.js', 'dist/login-redirect.js');
await copyFile('usage.js', 'dist/usage.js');
await copyFile('usage-ledger.js', 'dist/usage-ledger.js');
await copyFile('account-usage.js', 'dist/account-usage.js');
await copyFile('chat-contract.js', 'dist/chat-contract.js');
await copyFile('computer-time.js', 'dist/computer-time.js');
await copyFile('context-state.js', 'dist/context-state.js');
await copyFile('analysis-checkpoint.js', 'dist/analysis-checkpoint.js');
await copyFile('analysis-handoff.js', 'dist/analysis-handoff.js');
await copyFile('research-handoff.js', 'dist/research-handoff.js');
await copyFile('restart-reconciliation.js', 'dist/restart-reconciliation.js');
await copyFile('uncertain-action.js', 'dist/uncertain-action.js');
await copyFile('task-plan.js', 'dist/task-plan.js');
await copyFile('skill-command.js', 'dist/skill-command.js');
await copyFile('skill-creator.js', 'dist/skill-creator.js');
await copyFile('skills.js', 'dist/skills.js');
await copyFile('skill-library.js', 'dist/skill-library.js');
await copyFile('skill-stats.js', 'dist/skill-stats.js');
await copyFile('field-marks.js', 'dist/field-marks.js');
await copyFile('page-script.js', 'dist/page-script.js');
await copyFile('openwiki-workflow.js', 'dist/openwiki-workflow.js');
await build({entryPoints: ['skill-package.js'], outfile: 'dist/skill-package.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome125', minify: true});
await copyFile('project-tools.js', 'dist/project-tools.js');
await copyFile('project-connection.js', 'dist/project-connection.js');
await copyFile('wiki-folder.js', 'dist/wiki-folder.js');
await build({entryPoints: ['evidence-search.js'], outfile: 'dist/evidence-search.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome125', minify: true});
await copyFile('agent-trace.js', 'dist/agent-trace.js');
await copyFile('agent-harness.js', 'dist/agent-harness.js');
await copyFile('page-tools.js', 'dist/page-tools.js');
await copyFile('browser-approval.js', 'dist/browser-approval.js');
await build({entryPoints: ['canonical-json.js'], outfile: 'dist/canonical-json.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome125', minify: true});
await copyFile('browser-click-effect.js', 'dist/browser-click-effect.js');
await copyFile('browser-debugger-ownership.js', 'dist/browser-debugger-ownership.js');
await copyFile('browser-agent.js', 'dist/browser-agent.js');
await copyFile('browser-region.js', 'dist/browser-region.js');
await copyFile('verification-text-feedback.js', 'dist/verification-text-feedback.js');
await copyFile('browser-url.js', 'dist/browser-url.js');
await copyFile('browser-public-url.js', 'dist/browser-public-url.js');
await copyFile('form-workflow.js', 'dist/form-workflow.js');
await build({entryPoints: ['form-values.js'], outfile: 'dist/form-values.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome125', minify: true});
await copyFile('native-dialog-request.js', 'dist/native-dialog-request.js');
await copyFile('browser-dialogs.js', 'dist/browser-dialogs.js');
await copyFile('browser-capture.js', 'dist/browser-capture.js');
await copyFile('browser-scroll.js', 'dist/browser-scroll.js');
await copyFile('browser-diagnostics.js', 'dist/browser-diagnostics.js');
for (const file of ['browser-policy.js','browser-routines.js']) await copyFile(file, `dist/${file}`);
await build({entryPoints:['browser-transfers.js'],outfile:'dist/browser-transfers.js',bundle:true,platform:'browser',format:'esm',target:'chrome125',minify:true,external:['./browser-policy.js','./attachment-store.js']});
await copyFile('browser-workspace.js', 'dist/browser-workspace.js');
await copyFile('browser-pointer.js', 'dist/browser-pointer.js');
await copyFile('browser-drag.js', 'dist/browser-drag.js');
await copyFile('browser-popups.js', 'dist/browser-popups.js');
await copyFile('browser-observation.js', 'dist/browser-observation.js');
await copyFile('browser-effect.js', 'dist/browser-effect.js');
// page-script.js remembers slow tabs: one shared copy, not a second one inside this bundle.
await build({entryPoints: ['browser-content.js'], outfile: 'dist/browser-content.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome125', minify: true, external:['./background-images.js','./browser-url.js','./page-script.js']});
await cp('generated', 'dist/generated', {recursive: true});
await copyFile('browser-text.js', 'dist/browser-text.js');
await copyFile('browser-keyboard.js', 'dist/browser-keyboard.js');
await copyFile('browser-script-receipt.js', 'dist/browser-script-receipt.js');
await copyFile('browser-editor.js', 'dist/browser-editor.js');
await copyFile('script-feedback.js', 'dist/script-feedback.js');
await copyFile('browser-script-api.js', 'dist/browser-script-api.js');
await copyFile('attachments.js', 'dist/attachments.js');
await copyFile('attachment-store.js', 'dist/attachment-store.js');
await copyFile('attachment-limits.js', 'dist/attachment-limits.js');
await build({entryPoints: ['document-tools.js'], outfile: 'dist/document-tools.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome125', minify: true});
await copyFile('capture-store.js', 'dist/capture-store.js');
await copyFile('user-question.js', 'dist/user-question.js');
await copyFile('page-images.js', 'dist/page-images.js');
await copyFile('image-files.js', 'dist/image-files.js');
await build({entryPoints: ['script-sandbox.js'], outfile: 'dist/script-sandbox.js', bundle: true, platform: 'browser', format: 'esm', target: 'chrome120', minify: true});
await cp('node_modules/@playwright-repl/playwright-crx/lib', 'dist/playwright', {recursive: true});
// Playwright evaluates its utility script in the page's own world, where a page can have
// replaced Map. Arguments and results then fail to pass ("refs.set is not a function").
// The pinned bundle gets working built-ins in front of that script; a bundle without
// the exact place fails the build instead of shipping without the guard.
{
  const PLACE = 'const module = {};\n        ${source$5}\n        return new (module.exports.UtilityScript())';
  if (/[`\\]|\$\{/.test(PAGE_BUILTINS)) throw new Error('page_builtins_not_embeddable');
  let patched = 0;
  for (const name of (await readdir('dist/playwright')).filter(name => name.endsWith('.js'))) {
    const text = await readFile(`dist/playwright/${name}`, 'utf8');
    if (!text.includes(PLACE)) continue;
    if (text.split(PLACE).length !== 2) throw new Error('playwright_utility_script_place_ambiguous');
    await writeFile(`dist/playwright/${name}`, text.replace(PLACE, () => PLACE.replace('${source$5}', () => `${PAGE_BUILTINS}\n        \${source$5}`)));
    patched++;
  }
  if (patched !== 1) throw new Error('playwright_utility_script_place_missing');
}
await copyFile('node_modules/@playwright-repl/playwright-crx/LICENSE', 'dist/playwright/LICENSE');
await copyFile('node_modules/@playwright-repl/playwright-crx/NOTICE', 'dist/playwright/NOTICE');
await mkdir('dist/script-licenses', {recursive: true});
await copyFile('node_modules/big.js/LICENCE.md', 'dist/script-licenses/big-js-LICENSE');
await copyFile('node_modules/p-limit/license', 'dist/script-licenses/p-limit-LICENSE');
await copyFile('node_modules/yocto-queue/license', 'dist/script-licenses/yocto-queue-LICENSE');
for (const name of ['core', 'sortable', 'utilities', 'accessibility']) await copyFile(`node_modules/@dnd-kit/${name}/LICENSE`, `dist/script-licenses/dnd-kit-${name}-LICENSE`);
await copyFile('node_modules/yaml/LICENSE', 'dist/script-licenses/yaml-LICENSE');
await copyFile('node_modules/acorn/LICENSE', 'dist/script-licenses/acorn-LICENSE');
await copyFile('node_modules/fast-json-stable-stringify/LICENSE', 'dist/script-licenses/fast-json-stable-stringify-LICENSE');
await copyFile('node_modules/p-retry/license', 'dist/script-licenses/p-retry-LICENSE');
await copyFile('node_modules/@tanstack/query-core/LICENSE', 'dist/script-licenses/tanstack-query-core-LICENSE');
await copyFile('node_modules/is-network-error/license', 'dist/script-licenses/is-network-error-LICENSE');
await cp('node_modules/pdfjs-dist/cmaps', 'dist/document-assets/cmaps', {recursive: true});
await cp('node_modules/pdfjs-dist/standard_fonts', 'dist/document-assets/standard_fonts', {recursive: true});
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','dist/document-assets/pdf.worker.mjs');
await copyFile('node_modules/pdfjs-dist/LICENSE', 'dist/script-licenses/pdfjs-LICENSE');
await copyFile('node_modules/mammoth/LICENSE', 'dist/script-licenses/mammoth-LICENSE');
await copyDocumentLicenses(resolve('dist/script-licenses/documents'));
await copyFile('node_modules/dom-accessibility-api/LICENSE.md', 'dist/script-licenses/dom-accessibility-api-LICENSE');
await copyFile('node_modules/minisearch/LICENSE.txt', 'dist/script-licenses/minisearch-LICENSE');
await copyFile('node_modules/lowlight/license', 'dist/script-licenses/lowlight-LICENSE');
await copyFile('node_modules/highlight.js/LICENSE', 'dist/script-licenses/highlight.js-LICENSE');
await copyFile('node_modules/quickjs-emscripten-core/LICENSE', 'dist/script-licenses/quickjs-emscripten-LICENSE');
await copyFile('node_modules/@jitl/quickjs-singlefile-browser-release-sync/LICENSE', 'dist/script-licenses/quickjs-variant-LICENSE');
await writeFile('GUIDE.md', helpMarkdown());
await copyFile('GUIDE.md', 'dist/GUIDE.md');
await copyFile('node_modules/@e2e/cx-design-system/THIRD-PARTY-NOTICES.md', 'dist/THIRD-PARTY-NOTICES.md');
await copyFile('THIRD-PARTY-AGENT-NOTICES.md', 'dist/THIRD-PARTY-AGENT-NOTICES.md');
// Every relative module a packaged script imports must be packaged too. A module
// that exists only inside another bundle (context-evidence.js) was imported by
// browser-agent.js once, and the service worker never started.
const unresolved = [];
for (const file of (await readdir(resolve(root, 'dist'))).filter(name => name.endsWith('.js'))) {
  const text = await readFile(resolve(root, 'dist', file), 'utf8');
  for (const [, target] of text.matchAll(/(?:\bimport|\bexport)\s*(?:[^'";]*?\bfrom\s*)?['"](\.\/[^'"]+)['"]/g))
    if (!await readFile(resolve(root, 'dist', target)).then(() => true, () => false)) unresolved.push(`${file} -> ${target}`);
}
if (unresolved.length) throw new Error(`Packaged modules import missing files:\n${unresolved.join('\n')}`);
// Candidate checks must never replace an already published version's archive.
const candidate = process.argv.includes('--candidate');
const outputDirectory = candidate ? 'verification/candidate' : 'releases';
await mkdir(outputDirectory, {recursive: true});
const archive = resolve(root, outputDirectory, `${release.archiveStem}${candidate ? '-candidate' : ''}.zip`);
await rm(archive, {force: true});
const result = spawnSync('zip', ['-q', '-r', archive, '.'], {cwd: resolve(root, 'dist'), stdio: 'inherit'});
if (result.status !== 0) throw new Error('ZIP packaging failed');
const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${hash}  ${basename(archive)}\n`);
console.log(`Extension folder: ${resolve(root, 'dist')}\nZIP: ${archive}`);
