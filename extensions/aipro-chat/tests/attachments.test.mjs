import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeAttachment, bytesBase64, attachmentIds, attachmentVision, ATTACHMENT_LIMITS, clipboardAttachments, attachmentPayloads, validateDocument} from '../attachments.js';
import {pdfFile, wordFile} from './fixtures/documents.mjs';
import {runAgent, toPi} from '../agent-runtime.js';
import {contextTokens, compactHistory} from '../context-manager.js';
import {contextUsage} from '../usage.js';
import {hasConversation, activateConversation, newConversation} from '../conversations.js';
import {chatGPTModels} from '../chatgpt-api.js';
import {inspectModelList} from '../core.js';
import {goalReviewMessages} from '../goal-review.js';

const payload = (name, text) => ({name, data: bytesBase64(new TextEncoder().encode(text))});
test('text files preserve Unicode and HTML as reference text, rejecting binary and oversized input', () => {
  const file = decodeAttachment(payload('demo.tsx', 'const title = "누비";\n<script>notExecuted()</script>'));
  assert.equal(file.kind, 'text'); assert(file.text.includes('<script>')); assert(file.text.includes('누비'));
  assert.throws(() => decodeAttachment(payload('demo.exe', 'hello')), /attachment_type/);
  assert.throws(() => decodeAttachment(payload('demo.txt', '\0secret')), /attachment_encoding/);
  assert.throws(() => decodeAttachment({name: 'demo.txt', data: '/w=='}), /attachment_encoding/);
  assert.throws(() => decodeAttachment(payload('demo.txt', ' '.repeat(20))), /attachment_empty/);
  assert.throws(() => decodeAttachment(payload('demo.txt', 'x'.repeat(ATTACHMENT_LIMITS.textChars + 1))), /attachment_size/);
  assert.throws(() => decodeAttachment(payload('demo.png', '<svg></svg>')), /attachment_type/);
  assert.throws(() => decodeAttachment({name: 'demo.png', data: '???'}), /attachment_size/);
});
test('vision is explicit per provider, and SDK image capabilities survive model normalization', () => {
  assert(attachmentVision('aipro', 'QWEN3.8-27B-FP8-256K'));
  assert(!attachmentVision('aipro', 'GLM-5.2-NVFP4', {supportsImages: true}));
  assert(!attachmentVision('fabrix', 'QWEN3.8-27B-FP8-256K', {supportsImages: true}));
  const catalog = inspectModelList(chatGPTModels().payload);
  assert(catalog.models.some(model => attachmentVision('chatgpt', model.name, model)));
});
test('Pi conversion preserves uploaded images and text through OpenAI tool-loop requests', async () => {
  const messages = [{role: 'user', content: [{type: 'text', text: 'reference.png is a user-provided image'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,aGVsbG8='}}]}];
  assert.deepEqual(toPi(messages, 'test')[0].content.at(-1), {type: 'image', data: 'aGVsbG8=', mimeType: 'image/png'});
  let sent;
  await runAgent({messages, tools: [], signal: new AbortController().signal, complete: async wire => {sent = wire; return {content: 'done', finishReason: 'stop'};}});
  assert.deepEqual(sent[0].content, messages[0].content);
  assert.throws(() => toPi([{role: 'user', content: [{type: 'image_url', image_url: {url: 'https://untrusted.invalid/image.png'}}]}]), /attachment_invalid/);
  assert.equal(contextTokens(messages) - contextTokens([{role: 'user', content: [{type: 'text', text: 'reference.png is a user-provided image'}]}]), 4096);
});
test('draft-only attachments survive conversation switches and contribute to token estimates', () => {
  const chat = {...newConversation('aipro', 'model'), draftAttachments: [{id: 'file-a', tokens: 120}]};
  assert(hasConversation(chat));
  const state = {chat, settings: {modelId: 'model'}, activeProvider: 'aipro'};
  const patch = activateConversation(state, newConversation('aipro', 'model'));
  assert.deepEqual(patch.chatHistory[0].draftAttachments, chat.draftAttachments);
  assert.deepEqual(attachmentIds({...state, ...patch}), ['file-a']);
  const usage = contextUsage([], '', {name: 'model'}, false, '', {draftAttachments: chat.draftAttachments});
  assert.equal(usage.used, 120); assert.equal(usage.kind, 'estimated');
});
test('history compaction keeps source text and filename while excluding image bytes', async () => {
  const messages = [{id: 'old-file', role: 'user', content: [{type: 'text', text: 'reference.ts\nconst TITLE = "source-evidence-marker";'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,PRIVATEIMAGE'}}]}, {id: 'old-answer', role: 'assistant', content: 'read'}, {id: 'new', role: 'user', content: 'continue'}];
  let source = '';
  await compactHistory({messages, force: true, model: {}, signal: new AbortController().signal, invoke: async input => {
    source += JSON.stringify(input); return {content: JSON.stringify({goal: 'read source', constraints: [], decisions: [], completed: [], pending: [], references: ['reference.ts']}), finishReason: 'stop'};
  }});
  assert(source.includes('source-evidence-marker')); assert(source.includes('reference.ts')); assert(!source.includes('PRIVATEIMAGE'));
});

test('uploaded references survive a tool round and remain distinct from live reviewer evidence', async () => {
  const messages = [{role: 'user', content: [{type: 'text', text: 'reference.txt contains source-value'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,aGVsbG8='}}]}];
  const wires = [];
  await runAgent({messages, tools: [{type: 'function', function: {name: 'read_page', description: 'read', parameters: {type: 'object', properties: {}}}}],
    signal: new AbortController().signal, execute: async () => ({text: 'live page'}), complete: async wire => {
      wires.push(wire);
      return wires.length === 1 ? {content: '', calls: [{id: 'call_1', type: 'function', function: {name: 'read_page', arguments: '{}'}}], finishReason: 'tool_calls'} : {content: 'done', finishReason: 'stop'};
    }});
  assert.equal(wires.length, 2); assert(wires[1].some(message => message.content?.some?.(part => part.type === 'image_url')));
  const review = goalReviewMessages({goal: 'fill from reference', history: messages, evidence: [{id: 1, usable: true, tool: 'verify_page', result: {value: 'source-value'}}], answer: 'done', inputBudget: 20000});
  const serialized = JSON.stringify(review.messages);
  assert(serialized.includes('source-value')); assert(serialized.includes('reference.txt'));
  assert(serialized.includes('NOT live observations')); assert(serialized.includes('data:image/png;base64,aGVsbG8='));
});

test('clipboard keeps short text native and preserves long text and files without taking HTML instructions', async () => {
  assert.equal(clipboardAttachments({files: [], getData: type => type === 'text/html' ? '<b>ignored</b>' : 'short'}), null);
  const text = '참고용 원문\n'.repeat(31), files = clipboardAttachments({files: [], getData: () => text});
  assert.equal(await files[0].text(), text);
  const payloads = await attachmentPayloads(files, 0, 'user-paste');
  const result = decodeAttachment(payloads[0]); assert.equal(result.text, text); assert.equal(result.source, 'user-paste');
  const original = new File(['const data = 1;'], 'source.js');
  assert.equal(clipboardAttachments({files: [original], getData: () => 'ignored'})[0], original);
});

test('PDF and DOCX guards validate originals and reject corrupt or expansive containers', async () => {
  const pdf = pdfFile(), word = await wordFile();
  assert.doesNotThrow(() => validateDocument(new Uint8Array(pdf.buffer), pdf.name));
  assert.doesNotThrow(() => validateDocument(new Uint8Array(word.buffer), word.name));
  const decoded = decodeAttachment({name: pdf.name, data: pdf.buffer.toString('base64'), text: 'extracted reference'});
  assert.equal(decoded.kind, 'document'); assert.equal(decoded.text, 'extracted reference'); assert.equal(decoded.mimeType, 'application/pdf');
  assert.throws(() => decodeAttachment({name: pdf.name, data: pdf.buffer.toString('base64'), text: ''}), /attachment_document_empty/);
  assert.throws(() => decodeAttachment({name: pdf.name, data: pdf.buffer.toString('base64'), text: 'x'.repeat(ATTACHMENT_LIMITS.textChars + 1)}), /attachment_document_size/);
  assert.throws(() => validateDocument(new Uint8Array([1, 2, 3]), 'bad.docx'), /attachment_document/);
  const expanded = Buffer.from(word.buffer), central = expanded.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  expanded.writeUInt32LE(100 * 1024 * 1024, central + 24);
  assert.throws(() => validateDocument(new Uint8Array(expanded), 'oversized.docx'), /attachment_size/);
});
