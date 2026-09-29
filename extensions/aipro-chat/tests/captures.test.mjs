import test from 'node:test';
import assert from 'node:assert/strict';
import {captureRecord} from '../capture-store.js';
import {normalizeTrace} from '../agent-trace.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=';
const input = () => ({screenshot: {id: 'capture-fixture-123', url: 'https://example.test/page?code=secret#token', at: Date.UTC(2026, 8, 21)}, image: {mimeType: 'image/png', data: png}, requestId: 'reply', provider: 'aipro'});
test('capture and persisted trace share only a bounded UI-generated identifier', () => {
  const id = crypto.randomUUID();
  const steps = normalizeTrace([{id, tool: 'run_playwright', status: 'done', args: {secret: 'private'}}]);
  assert.deepEqual(steps, [{id, tool: 'run_playwright', status: 'done'}]);
  assert.equal(captureRecord({...input(), traceId: id}).traceId, steps[0].id);
  for (const invalid of ['https://private.test/?token=secret', 'Bearer private', {}, 'a'.repeat(1000)]) {
    assert.equal(captureRecord({...input(), traceId: invalid}).traceId, undefined);
    assert.deepEqual(normalizeTrace([{id: invalid, tool: 'capture_page', status: 'done'}]), [{tool: 'capture_page', status: 'done'}]);
  }
  assert.equal(captureRecord(input()).traceId, undefined);
});
test('capture attachment keeps only browser provenance and the original PNG, never callback parameters', async () => {
  const record = captureRecord(input());
  assert.equal(record.source, 'browser-tab'); assert.equal(record.host, 'example.test');
  assert.equal(record.width, 1); assert.equal(record.height, 1);
  assert.equal(record.blob.type, 'image/png'); assert.deepEqual(Buffer.from(await record.blob.arrayBuffer()), Buffer.from(png, 'base64'));
  assert(!JSON.stringify(record).includes('secret')); assert(!JSON.stringify(record).includes('token'));
  assert.match(record.filename, /^browser-capture-[a-zA-Z0-9-]+\.png$/);
});
test('capture store refuses non-browser origins, non-PNG payloads and unsafe attachment identifiers', () => {
  for (const url of ['file:///private/source', 'chrome://settings', 'data:image/png;base64,abc', 'https://user:password@example.test']) {
    const value = input(); value.screenshot.url = url; assert.throws(() => captureRecord(value));
  }
  for (const data of [btoa('<html>not a screenshot</html>'), 'invalid-base64', 'iVBOR']) {
    const value = input(); value.image.data = data; assert.throws(() => captureRecord(value));
  }
  const svg = input(); svg.image.mimeType = 'image/svg+xml'; assert.throws(() => captureRecord(svg));
  const path = input(); path.screenshot.id = '../capture.png'; assert.throws(() => captureRecord(path));
});
