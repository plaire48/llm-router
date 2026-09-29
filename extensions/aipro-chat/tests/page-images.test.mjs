import test from 'node:test';
import assert from 'node:assert/strict';
import {imageFile, imageFilename, IMAGE_FILE_LIMIT} from '../image-files.js';
import {pageImageRecord} from '../capture-store.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

test('page image attachment rejects HTML and excessive files and detects supported formats from bytes', () => {
  for (const [prefix, type] of [['GIF89a', 'image/gif'], ['RIFF0000WEBP', 'image/webp'], ['0000ftypavif', 'image/avif'], ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml']]) assert.equal(imageFile(btoa(prefix)).mimeType, type);
  for (const text of ['<html><svg></svg></html>', '{"error":"login"}', '<!DOCTYPE svg><svg/>', '<?xml?><!ENTITY foo><svg/>']) assert.throws(() => imageFile(btoa(text)), /image_unavailable/);
  assert.throws(() => imageFile('A'.repeat(Math.ceil(IMAGE_FILE_LIMIT / 3) * 4 + 4)), /image_too_large/);
});
test('image filenames preserve a safe basename and detected format, excluding credentials and query parameters', () => {
  assert.equal(imageFilename('https://cdn.test/path/hero.jpeg?signature=private', '', 'webp'), 'hero.webp');
  assert.equal(imageFilename('blob:https://cdn.test/uuid', '푸른 가방', 'png'), '푸른 가방.png');
  assert.equal(imageFilename('https://cdn.test/CON.jpg', '', 'jpg'), 'page-image.jpg');
  assert(!imageFilename(null, '../bad:<name>.html', 'png').includes('/'));
});
test('page image record retains original bytes and bounded labels without source URL secrets', async () => {
  const data = btoa('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>');
  const record = pageImageRecord({screenshot: {id: 'original-fixture-123', url: 'https://example.test/page?token=private', at: 1234, width: 100, height: 50, label: '브랜드 로고', filename: 'brand.svg'}, image: {data}, requestId: 'reply', provider: 'aipro'});
  assert.equal(record.source, 'page-image'); assert.equal(record.mimeType, 'image/svg+xml'); assert.equal(record.filename, 'brand.svg');
  assert.deepEqual(Buffer.from(await record.blob.arrayBuffer()), Buffer.from(data, 'base64'));
  assert(!JSON.stringify(record).includes('private'));
});
test('original image tools work for text-only models without enabling screenshot vision', () => {
  const tools = browserTools({id: 'page'}, BUILTIN_SKILLS[0], 'GLM-5.2-NVFP4', {vision: false}).map(tool => tool.function.name);
  assert(tools.includes('find_images')); assert(tools.includes('attach_images')); assert(!tools.includes('capture_page'));
});
