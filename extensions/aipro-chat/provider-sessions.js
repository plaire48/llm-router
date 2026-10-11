// Session-only inactive connections. The active fields stay compatible with the
// inference pipeline; there is never a second copy of the active credential.
export const PROVIDERS = ['aipro', 'chatgpt', 'fabrix'];
const providerOf = credential => credential?.provider || 'aipro';
export function providerSession(session, provider) {
  if (session.credential && providerOf(session.credential) === provider) return session;
  return session.providerSessions?.[provider] || {};
}
export function updateProviderSession(session, provider, patch) {
  if (!providerSession(session, provider).credential) throw new Error('no_credential');
  if (session.credential && providerOf(session.credential) === provider) return patch;
  return {providerSessions: {...session.providerSessions, [provider]: {...session.providerSessions[provider], ...patch}}};
}
export function connectionStatus(credential, provider, now = Date.now()) {
  return {present: !!credential, provider, expired: !!credential?.expiresAt && credential.expiresAt <= now && !(provider === 'chatgpt' && credential.refreshToken),
    rejected: !!credential?.rejected, receivedAt: credential?.receivedAt};
}
export function connectionStatuses(session, now = Date.now()) {
  return Object.fromEntries(PROVIDERS.map(provider => [provider, connectionStatus(providerSession(session, provider).credential, provider, now)]));
}
export function activateProviderSession(session, provider) {
  if (!PROVIDERS.includes(provider)) throw new Error('invalid_sender');
  const inactive = Object.fromEntries(PROVIDERS.filter(key => session.providerSessions?.[key]?.credential).map(key => [key, session.providerSessions[key]]));
  if (session.credential) {
    const credential = session.credential;
    inactive[providerOf(credential)] = {credential,
      catalog: session.catalog?.credentialReceivedAt === credential.receivedAt ? session.catalog : null,
      accountUsage: session.accountUsage?.credentialReceivedAt === credential.receivedAt ? session.accountUsage : null};
  }
  const selected = inactive[provider] || {};
  delete inactive[provider];
  return {providerSessions: inactive, credential: selected.credential || null, catalog: selected.catalog || null, accountUsage: selected.accountUsage || null, page: null,
    authReport: {stage: selected.credential ? 'connection_restored' : 'not_started'}};
}
export function removeProviderSession(session, provider) {
  if (!PROVIDERS.includes(provider)) throw new Error('invalid_sender');
  const inactive = {...session.providerSessions};
  delete inactive[provider];
  return {providerSessions: inactive, ...(session.credential && providerOf(session.credential) === provider ? {credential: null, catalog: null, accountUsage: null, page: null} : {})};
}
