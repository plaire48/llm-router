import test from 'node:test';
import assert from 'node:assert/strict';
import {activateProviderSession, removeProviderSession, updateProviderSession, connectionStatuses, providerSession} from '../provider-sessions.js';

const credential = (provider, id) => ({provider, token: `secret-${provider}-${id}`, receivedAt: id, expiresAt: 200});
const apply = (session, patch) => ({...session, ...patch});
test('provider updates retain the active selection and unrelated inactive sessions', () => {
  const s = {credential: credential('aipro', 1), catalog: {models: ['glm']}, providerSessions: {chatgpt: {credential: credential('chatgpt', 2)}, fabrix: {credential: credential('fabrix', 3)}}};
  const next = apply(s, updateProviderSession(s, 'chatgpt', {accountUsage: {data: 'quota'}}));
  assert.deepEqual(next.credential, s.credential); assert.deepEqual(next.catalog, s.catalog);
  assert.deepEqual(next.providerSessions.fabrix, s.providerSessions.fabrix);
  assert.equal(providerSession(next, 'chatgpt').accountUsage.data, 'quota');
  assert.deepEqual(updateProviderSession(s, 'aipro', {catalog: null}), {catalog: null});
  assert.throws(() => updateProviderSession({}, 'chatgpt', {}), /no_credential/);
});
test('round trips retain each connection, catalog and account usage without copying the active credential', () => {
  let s = {credential: credential('aipro', 1), catalog: {credentialReceivedAt: 1, models: ['glm']}, page: {id: 'old-page'}};
  s = apply(s, activateProviderSession(s, 'chatgpt'));
  assert.equal(s.credential, null); assert.equal(s.page, null);
  s = {...s, credential: {...credential('chatgpt', 2), refreshToken: 'private-refresh'}, catalog: {credentialReceivedAt: 2, models: ['gpt']}, accountUsage: {credentialReceivedAt: 2, data: 'quota'}};
  s = apply(s, activateProviderSession(s, 'aipro'));
  assert.equal(s.credential.token, 'secret-aipro-1'); assert.deepEqual(s.catalog.models, ['glm']); assert.equal(s.accountUsage, null);
  assert.equal(s.providerSessions.aipro, undefined);
  s = apply(s, activateProviderSession(s, 'chatgpt'));
  assert.equal(s.credential.refreshToken, 'private-refresh'); assert.equal(s.accountUsage.data, 'quota'); assert.equal(s.providerSessions.chatgpt, undefined);
  s.credential.token = 'refreshed-token';
  s = apply(s, activateProviderSession(s, 'aipro')); s = apply(s, activateProviderSession(s, 'chatgpt'));
  assert.equal(s.credential.token, 'refreshed-token');
});
test('logout removes only the chosen provider and cannot restore it from a cached copy', () => {
  let s = {credential: credential('aipro', 1), providerSessions: {chatgpt: {credential: credential('chatgpt', 2)}}};
  s = apply(s, removeProviderSession(s, 'chatgpt'));
  assert.equal(s.credential.provider, 'aipro'); assert.equal(providerSession(s, 'chatgpt').credential, undefined);
  s = apply(s, removeProviderSession(s, 'aipro'));
  assert.equal(s.credential, null); assert.deepEqual(s.providerSessions, {});
  s = apply(s, activateProviderSession(s, 'aipro')); assert.equal(s.credential, null);
});
test('connection summaries omit secrets and distinguish expiration, refresh and rejection', () => {
  const s = {credential: credential('aipro', 1), providerSessions: {chatgpt: {credential: {...credential('chatgpt', 2), refreshToken: 'private-refresh'}}, fabrix: {credential: {...credential('fabrix', 3), expiresAt: null, clientKey: 'private-key', rejected: true}}}};
  const status = connectionStatuses(s, 300);
  assert.equal(status.aipro.expired, true); assert.equal(status.chatgpt.expired, false); assert.equal(status.fabrix.rejected, true);
  assert(!/secret|private|token|clientKey/i.test(JSON.stringify(status)));
  assert(!Object.values(connectionStatuses({}, 300)).some(s => s.present));
});
test('invalid providers and catalogs from a different credential are not restored', () => {
  const s = {credential: credential('aipro', 1), catalog: {credentialReceivedAt: 9, models: ['wrong']}, accountUsage: {credentialReceivedAt: 9}};
  const next = activateProviderSession(s, 'aipro'); assert.equal(next.catalog, null); assert.equal(next.accountUsage, null);
  assert.throws(() => activateProviderSession(s, 'unknown'), /invalid_sender/);
  assert.throws(() => removeProviderSession(s, 'unknown'), /invalid_sender/);
});
