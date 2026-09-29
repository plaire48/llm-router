// Chrome managed storage is an administrative ceiling, never a permission grant.
const features = ['AutomationEnabled','UploadsEnabled','DownloadsEnabled','RecordingEnabled','SchedulingEnabled'];
const unavailable = () => ({invalid:true, AutomationEnabled:false});
export function normalizeBrowserPolicy(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('browser_policy_invalid');
  const policy = {};
  for (const key of features) if (key in raw) {
    if (typeof raw[key] !== 'boolean') throw new Error('browser_policy_invalid');
    policy[key] = raw[key];
  }
  for (const key of ['AllowedOrigins','BlockedOrigins']) if (key in raw) {
    if (!Array.isArray(raw[key]) || raw[key].length > 100) throw new Error('browser_policy_invalid');
    policy[key] = raw[key].map(value => {
      if (typeof value !== 'string') throw new Error('browser_policy_invalid');
      let url; try {url = new URL(value);} catch {throw new Error('browser_policy_invalid');}
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.origin !== value) throw new Error('browser_policy_invalid');
      return url.origin;
    });
  }
  return policy;
}
export function createBrowserPolicyReader({read, waitMs = 5000, setTimer = setTimeout, clearTimer = clearTimeout}) {
  let current = unavailable(), generation = 0, active = null;
  const snapshot = () => structuredClone(current);
  function refresh({invalidate = false} = {}) {
    if (invalidate) {generation++; current = unavailable();}
    if (!active) {
      current = unavailable();
      const operation = {generation: ++generation};
      active = operation;
      let release;
      operation.wait = new Promise(resolve => {release = resolve;});
      // The wait expires, not the underlying Chrome operation (which has no
      // cancellation API). Keep it single-flight until it actually settles.
      const timer = setTimer(release, waitMs);
      Promise.resolve().then(read).then(normalizeBrowserPolicy).catch(unavailable).then(policy => {
        if (operation.generation === generation) current = policy;
        if (active === operation) active = null;
        clearTimer(timer); release();
      });
    }
    return active.wait.then(snapshot);
  }
  return {refresh, snapshot};
}
const reader = createBrowserPolicyReader({read: () => chrome.storage.managed.get(null)});
export const refreshBrowserPolicy = options => reader.refresh(options);
export function assertBrowserPolicy(url, feature = 'AutomationEnabled', policy = reader.snapshot()) {
  if (policy.invalid) throw new Error('browser_policy_invalid');
  if (policy.AutomationEnabled === false || policy[feature] === false) throw new Error('browser_policy_blocked');
  if (url) {
    let parsed;try {parsed = new URL(url);}catch {throw new Error('page_restricted');}
    if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('page_restricted');
    if (policy.BlockedOrigins?.includes(parsed.origin) || policy.AllowedOrigins && !policy.AllowedOrigins.includes(parsed.origin)) throw new Error('browser_policy_blocked');
  }
}
export const browserPolicySnapshot = () => reader.snapshot();
