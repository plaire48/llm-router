import {chromium} from 'playwright';
import {cp, mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

// Render the actual product components. No account or mock auth is needed.
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-brand-'));
const extension = resolve(profile, 'extension');
await cp(resolve('dist'), extension, {recursive: true});
await mkdir('verification', {recursive: true});
const context = await chromium.launchPersistentContext(profile, {
  headless: true, executablePath: process.env.CHROME_BINARY,
  viewport: {width: 360, height: 800},
  recordVideo: {dir: resolve(profile, 'video'), size: {width: 360, height: 800}},
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await page.getByRole('button', {name: 'AI Pro', exact: true}).waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll('img')].map(img => img.decode()));
    await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  });
  await page.screenshot({path: 'verification/nubi-login.png'});
  await page.waitForTimeout(10_000);
  const video = page.video();
  await page.close();
  await video.saveAs(resolve('verification/nubi-motion.webm'));

  const logoPage = await context.newPage();
  await logoPage.setViewportSize({width: 860, height: 320});
  await logoPage.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await logoPage.locator('.nubi-logo').waitFor();
  await logoPage.evaluate(() => {
    const logo = document.querySelector('.nubi-logo').cloneNode(true);
    document.body.replaceChildren(logo);
    document.documentElement.dataset.motion = 'paused';
  });
  await logoPage.addStyleTag({content: `html, body {height: 100%; background: transparent; margin: 0;} body {display: grid; place-items: center;} .nubi-logo {gap: 20px;} .nubi-logo .agent-mark {width: 196px; height: 196px;} .nubi-logo .nubi-wordmark {font-size: 100px;} .agent-mark, .agent-mark > img {animation: none !important;} .bird-frame {opacity: 0 !important;} .bird-base {opacity: 1 !important;}`});
  await logoPage.evaluate(() => document.fonts.ready);
  await logoPage.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
  await logoPage.screenshot({path: 'design/brand/nubi-logo.png', omitBackground: true});
  await logoPage.addStyleTag({content: 'body {background: var(--deck-background);}'});
  await logoPage.screenshot({path: 'verification/nubi-logo-preview.png'});
  console.log('Generated Nubi logo, product screenshot and motion preview.');
} finally {await context.close(); await rm(profile, {recursive: true, force: true});}
