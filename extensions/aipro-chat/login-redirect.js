// One ephemeral rule bound to the provider's exact callback and login tab.
export const LOGIN_REDIRECT_RULE_ID = 91001;

export function loginRedirectRule(attempt, callbackURL) {
  if (!['aipro', 'chatgpt'].includes(attempt.provider) || !Number.isInteger(attempt.tabId) || !Number.isInteger(attempt.port) || attempt.port < 1 || attempt.port > 65535 || !/^[a-zA-Z0-9-]{8,100}$/.test(attempt.id) || (attempt.provider === 'chatgpt' && attempt.port !== 1455)) throw new Error('callback_receiver_unavailable');
  const callback = attempt.provider === 'chatgpt' ? '(localhost):1455/auth/callback' : `(localhost|127\\.0\\.0\\.1|\\[::1\\]):${attempt.port}/auth`;
  return {
    id: LOGIN_REDIRECT_RULE_ID, priority: 1,
    action: {type: 'redirect', redirect: {regexSubstitution: `${callbackURL}?attempt=${attempt.id}#\\2`}},
    condition: {
      tabIds: [attempt.tabId], resourceTypes: ['main_frame'], requestMethods: ['get'],
      regexFilter: `^http://${callback}\\?([^#]*)$`,
    },
  };
}

export function validRedirectSender(message, sender, attempt, extensionId, callbackURL) {
  return ['aipro', 'chatgpt'].includes(attempt?.provider) && attempt.receiverVersion === 4 && attempt.expiresAt > Date.now() &&
    sender.id === extensionId && sender.tab?.id === attempt.tabId && sender.frameId === 0 &&
    sender.url?.split(/[?#]/)[0] === callbackURL && message.nonce === attempt.id &&
    typeof message.query === 'string' && message.query.length <= 65536;
}
