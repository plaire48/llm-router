// DOM extraction microbenchmark. No model is called and no task is graded.
import {chromium} from 'playwright';
import {collectSnapshot} from '../generated/browser-dom.js';
import {collectPageContent} from '../generated/browser-content-dom.js';
import {contentPacket} from '../browser-content.js';

const query = process.env.NUBI_READ_QUERY || '펜싱 경기 결과';
const url = process.env.NUBI_READ_URL || `https://search.naver.com/search.naver?query=${encodeURIComponent('2026 아시안게임 펜싱 대한민국 결과')}`;
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage({locale: 'ko-KR'});
  const navigation = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 30000});
  const sample = async (name, action) => {
    const runs = [];
    for (let index = 0; index < 3; index++) {
      const started = performance.now();
      const result = await action();
      runs.push({ms: Math.round(performance.now() - started), bytes: JSON.stringify(result).length,
        textChars: result.text?.length ?? result.ranges?.[0]?.markdown?.length ?? null,
        coverage: result.coverage, truncated: result.truncated ?? null});
    }
    const sorted = runs.map(run => run.ms).toSorted((a, b) => a - b);
    return {name, medianMs: sorted[1], medianBytes: runs.map(run => run.bytes).toSorted((a, b) => a - b)[1], runs};
  };
  const full = await sample('screen_full', () => page.evaluate(collectSnapshot, {query: ''}));
  const focused = await sample('screen_focused', () => page.evaluate(collectSnapshot, {query}));
  const content = await sample('content_query', async () => {
    const raw = await page.evaluate(collectPageContent);
    return contentPacket({...raw, sourceIdentity: ['benchmark', raw.url], frame: 0}, {query});
  });
  console.log(JSON.stringify({url: new URL(url).origin + new URL(url).pathname, httpStatus: navigation?.status(), query,
    scope: 'Local DOM extraction and returned payload only; excludes model inference, network navigation, extension messaging and task success.',
    samples: [full, focused, content]}, null, 2));
} finally {await browser.close();}
