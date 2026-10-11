import {parseDocument} from 'yaml';

export const SKILL_PACKAGE_LIMIT = 200000;
const bytes = value => new TextEncoder().encode(value).length;
const invalid = () => {throw new Error('skill_invalid');};

export function parseSkillMarkdown(text, filename = '내 스킬') {
  if (typeof text !== 'string' || bytes(text) > 64000) invalid();
  const front = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  let metadata = {};
  if (front) {
    try {
      const document = parseDocument(front[1], {schema: 'core', uniqueKeys: true});
      if (document.errors.length || document.warnings.length) invalid();
      metadata = document.toJS({maxAliasCount: 0});
      if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') invalid();
      for (const key of ['name', 'description', 'compatibility']) if (metadata[key] != null && typeof metadata[key] !== 'string') invalid();
    } catch {invalid();}
  } else if (text.startsWith('---\n') || text.startsWith('---\r\n')) invalid();
  return {name: metadata.name || text.match(/^#\s+(.+)$/m)?.[1] || filename.replace(/\.md$/i, ''), description: metadata.description || '', compatibility: metadata.compatibility || '', instructions: front ? text.slice(front[0].length).trim() : text.trim()};
}

export function normalizeSkillResources(resources = []) {
  if (!Array.isArray(resources) || resources.length > 24) invalid();
  const seen = new Set(); let total = 0;
  return resources.map(resource => {
    const path = resource?.path;
    if (typeof path !== 'string' || path.length > 200 || !/^(references|scripts|assets)\//.test(path) || path.split('/').some(part => !part || part.startsWith('.') || /[\\:\x00-\x1f]/.test(part)) || /(?:^|\/)(?:node_modules|credentials|secrets)(?:\/|\.)/i.test(path) || !/\.(md|txt|json|csv|js|mjs|py|html|css|yaml|yml)$/i.test(path) || seen.has(path.toLowerCase())) invalid();
    if (typeof resource.content !== 'string' || resource.content.includes('\0') || bytes(resource.content) > 48000) invalid();
    total += bytes(resource.content); if (total > SKILL_PACKAGE_LIMIT) invalid();
    seen.add(path.toLowerCase());
    return {path, content: resource.content};
  }).sort((a, b) => a.path.localeCompare(b.path));
}

// A folder import is a reviewed local snapshot, not filesystem execution access.
export async function readSkillFolder(files) {
  const entries = Array.from(files || []);
  const roots = entries.filter(file => /(?:^|\/)SKILL\.md$/.test(file.webkitRelativePath || file.name));
  if (roots.length !== 1) invalid();
  const main = roots[0], mainPath = main.webkitRelativePath || main.name;
  const prefix = mainPath.slice(0, -'SKILL.md'.length);
  const resources = []; let total = 0;
  if (entries.length > 30) invalid();
  for (const file of entries) {
    const full = file.webkitRelativePath || file.name;
    if (!full.startsWith(prefix)) invalid();
    const path = full.slice(prefix.length);
    // Operating-system folder metadata is not a skill resource.
    if (path === '.DS_Store') continue;
    total += file.size; if (total > SKILL_PACKAGE_LIMIT || file.size > (file === main ? 64000 : 48000)) invalid();
    if (file !== main) resources.push({path, content: await file.text()});
  }
  return {...parseSkillMarkdown(await main.text(), prefix.split('/').filter(Boolean).at(-1)), resources: normalizeSkillResources(resources)};
}
