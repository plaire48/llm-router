const storageKey = projectId => `nubi-session-tabs-v1:${projectId}`;

export function restoreSessionNavigation(projectId, tasks, storage = globalThis.localStorage) {
  const known = new Set(tasks.map(task => task.id));
  try {
    const saved = JSON.parse(storage.getItem(storageKey(projectId)) || '{}');
    const tabs = [...new Set((Array.isArray(saved.tabs) ? saved.tabs : []).filter(id => typeof id === 'string' && known.has(id)))];
    return {tabs, selected: tabs.includes(saved.selected) ? saved.selected : null};
  } catch {return {tabs: [], selected: null};}
}

export function saveSessionNavigation(projectId, tabs, selected, storage = globalThis.localStorage) {
  if (!projectId) return;
  try {storage.setItem(storageKey(projectId), JSON.stringify({tabs, selected}));} catch {}
}

export function openSession(tabs, id) {
  return id && !tabs.includes(id) ? [...tabs, id] : tabs;
}

export function closeSession(tabs, selected, id) {
  const index = tabs.indexOf(id);
  if (index < 0) return {tabs, selected};
  const next = tabs.filter(tab => tab !== id);
  return {tabs: next, selected: selected === id ? next[Math.min(index, next.length - 1)] || null : selected};
}

export function groupSessionsByDate(tasks, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const dateKey = date => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const groups = new Map();
  for (const task of [...tasks].sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))) {
    const date = new Date(task.createdAt);
    const key = Number.isNaN(date.getTime()) ? 'unknown' : dateKey(date);
    const label = key === 'unknown' ? '날짜 미상' : key === dateKey(today) ? '오늘' : key === dateKey(yesterday) ? '어제' : new Intl.DateTimeFormat('ko-KR', {year: 'numeric', month: 'long', day: 'numeric'}).format(date);
    if (!groups.has(key)) groups.set(key, {key, label, tasks: []});
    groups.get(key).tasks.push(task);
  }
  return [...groups.values()];
}
