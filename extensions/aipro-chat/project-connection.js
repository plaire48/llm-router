import {projectOrigin, projectRequest, validateProjectInfo, pairedProject} from './project-tools.js';

function tabOrigin(tab) {
  try {
    const url = new URL(tab?.url);
    if (url.pathname.startsWith('/auth')) return null;
    return projectOrigin(url.origin);
  } catch {return null;}
}
export async function projectCandidate(preferred) {
  if (tabOrigin(preferred)) return {origin: tabOrigin(preferred), tabId: preferred.id, title: String(preferred.title || '').slice(0, 160)};
  return null;
}

async function loadedTab(tabId, origin) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (!current) throw new Error('project_unavailable');
  if (current.status === 'complete') {
    if (tabOrigin(current) !== origin) throw new Error('project_address');
    return current;
  }
  return new Promise((resolve, reject) => {
    const finish = (error, tab) => {clearTimeout(timer); chrome.tabs.onUpdated.removeListener(updated); chrome.tabs.onRemoved.removeListener(removed); error ? reject(error) : resolve(tab);};
    const updated = (id, changes, tab) => {
      if (id === tabId && changes.status === 'complete') finish(tabOrigin(tab) === origin ? null : new Error('project_address'), tab);
    };
    const removed = id => {if (id === tabId) finish(new Error('project_unavailable'));};
    const timer = setTimeout(() => finish(new Error('project_unavailable')), 10000);
    chrome.tabs.onUpdated.addListener(updated); chrome.tabs.onRemoved.addListener(removed);
    // Close the completion race between tabs.get and listener registration.
    chrome.tabs.get(tabId).then(tab => {if (tab.status === 'complete') updated(tabId, {status: 'complete'}, tab);}, () => removed(tabId));
  });
}

export async function connectProject({origin: address, tabId}) {
  const origin = projectOrigin(address);
  if (!await chrome.permissions.contains({origins: [`${origin}/*`]})) throw new Error('project_permission');
  validateProjectInfo(await projectRequest(origin, 'info'));
  let tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (tabOrigin(tab) !== origin) tab = null;
  if (!tab) tab = (await chrome.tabs.query({url: `${origin}/*`})).find(tab => tabOrigin(tab) === origin);
  if (tab) {
    // Pair codes are one-use. Refresh the known visualizer only, never a model-supplied URL.
    await chrome.tabs.reload(tab.id);
  } else tab = await chrome.tabs.create({url: `${origin}/`, active: false});
  await loadedTab(tab.id, origin);
  let result;
  try {
    [result] = await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'ISOLATED',
      func: expected => location.origin === expected && !location.pathname.startsWith('/auth')
        ? {code: document.querySelector('meta[name="nubi-pairing-code"]')?.content || '', origin: location.origin} : null, args: [origin]});
  } catch {throw new Error('project_permission');}
  const data = result?.result;
  if (data?.origin !== origin || typeof data.code !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(data.code)) throw new Error('project_pairing');
  const paired = await projectRequest(origin, 'pair', {body: {code: data.code}}).catch(error => {
    throw new Error(['project_expired', 'project_arguments', 'project_scope'].includes(error.message) ? 'project_pairing' : error.message);
  });
  return pairedProject(origin, paired);
}

export async function revokeProject(connection) {
  if (!connection?.token) return;
  await projectRequest(connection.origin, 'disconnect', {token: connection.token, body: {}}).catch(() => {});
}
