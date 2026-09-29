import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPageContent} from '../browser-content-dom.js';

test('native PDF MIME is an explicit capability gap before reading viewer DOM', () => {
  const previous = globalThis.document;
  try {
    globalThis.document = {contentType: 'application/pdf', get body() {throw Error('Viewer body must not be parsed as source text');}};
    const result = collectPageContent();
    assert.equal(result.error, 'page_content_pdf_unavailable');
    assert.equal(result.retryable, false);
    assert.equal(result.text, undefined);
    assert.match(result.instruction, /original request allows/);
    assert.match(result.instruction, /weaken a requirement/);
  } finally {if (previous === undefined) delete globalThis.document;else globalThis.document = previous;}
});
