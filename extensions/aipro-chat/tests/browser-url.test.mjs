import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshBrowserPolicy} from '../browser-policy.js';
globalThis.chrome={storage:{managed:{get:async()=>({})}}};
await refreshBrowserPolicy();
import {sourceURL, exactBrowserURL} from '../browser-url.js';

test('display keeps public video/article identity without private queries', () => {
  assert.equal(sourceURL('https://www.youtube.com/watch?v=abcdefghijk&token=secret#private'), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(sourceURL('https://news.naver.com/main/read.naver?oid=001&aid=0012345678&session=secret'), 'https://news.naver.com/main/read.naver?oid=001&aid=0012345678');
  assert.equal(sourceURL('https://example.com/search?q=private&code=secret'), 'https://example.com/search');
  assert.equal(sourceURL('https://youtube.com.evil.test/watch?v=abcdefghijk'), 'https://youtube.com.evil.test/watch');
  assert.equal(sourceURL('https://www.youtube.com/watch?v=abcdefghijk&v=othersecret'), 'https://www.youtube.com/watch');
  assert.equal(sourceURL('https://www.youtube.com/watch?v=long-private-secret-value'), 'https://www.youtube.com/watch');
});

test('exact verification cannot confuse redacted resource URLs', () => {
  const first = 'https://www.youtube.com/watch?v=abcdefghijk';
  assert.equal(exactBrowserURL(first, first), true);
  assert.equal(exactBrowserURL(first, 'https://www.youtube.com/watch?v=lmnopqrstuv'), false);
  assert.equal(exactBrowserURL('https://example.com/?page=1', 'https://example.com/?page=2'), false);
  assert.equal(exactBrowserURL('https://example.com/#first', 'https://example.com/#second'), false);
  assert.equal(exactBrowserURL('https://example.com/', 'https://example.com/?token=private'), false);
  for (const url of ['file:///tmp/x','https://user:secret@example.com/', 'https://auth.openai.com/']) {
    assert.equal(exactBrowserURL(url,url), false);
    assert.equal(sourceURL(url),null);
  }
});

test('public tourism content identity survives while unrelated, duplicated and private queries do not', () => {
  const base = 'https://korean.visitkorea.or.kr/detail/ms_detail.do';
  const id = '0363da87-ef3b-4c21-8508-34f70dda31fb';
  assert.equal(sourceURL(`${base}?cotid=${id}&token=secret&email=private#account`), `${base}?cotid=${id}`);
  assert.equal(sourceURL(`${base}?cotid=${id}&cotid=${id}`), base);
  assert.equal(sourceURL(`${base}?cotid=private-value`), base);
  assert.equal(sourceURL(`https://korean.visitkorea.or.kr/account?cotid=${id}`), 'https://korean.visitkorea.or.kr/account');
  assert.equal(sourceURL(`https://korean.visitkorea.or.kr.evil.test/detail/ms_detail.do?cotid=${id}`), 'https://korean.visitkorea.or.kr.evil.test/detail/ms_detail.do');
});
