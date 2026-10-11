import {zipSync, unzipSync, strToU8} from 'fflate';
import {normalizeSkill, importSkillFolder} from './skills.js';
import {SKILL_PACKAGE_LIMIT} from './skill-package.js';
import {skillCommand} from './skill-command.js';
const invalid = () => {throw new Error('skill_archive_invalid');};
export function exportSkillArchive(value) {
  const skill = normalizeSkill(value), root = skillCommand(skill);
  const markdown = `---\nname: ${JSON.stringify(skill.name)}\ndescription: ${JSON.stringify(skill.description)}\ncompatibility: ${JSON.stringify(skill.compatibility || 'Nubi browser tools. No native Python or Node execution.')}\n---\n\n${skill.instructions}\n`;
  const entries = [[`${root}/SKILL.md`, strToU8(markdown)], ...skill.resources.map(r => [`${root}/${r.path}`, strToU8(r.content)])];
  if (entries.reduce((sum, [, data]) => sum + data.length, 0) > SKILL_PACKAGE_LIMIT) invalid();
  return zipSync(Object.fromEntries(entries), {level: 6});
}
export async function importSkillArchive(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > SKILL_PACKAGE_LIMIT + 16000) invalid();
  let total = 0, count = 0;
  const seen = new Set();
  try {
    const contents = unzipSync(bytes, {filter: file => {
      const path = file.name, directory = path.endsWith('/');
      if (++count > 32 || path.length > 260 || path.split('/').some((part, i, all) => (!part && !(directory && i === all.length - 1)) || part.startsWith('.') || /[\\:\x00-\x1f]/.test(part)) || seen.has(path.toLowerCase())) invalid();
      seen.add(path.toLowerCase());
      if (directory) {if (file.originalSize !== 0) invalid(); return false;}
      total += file.originalSize;
      if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0 || file.originalSize > 64000 || total > SKILL_PACKAGE_LIMIT) invalid();
      return true;
    }});
    const entries = Object.entries(contents).map(([name, data]) => ({name, webkitRelativePath:name, size:data.length, text: async () => new TextDecoder('utf-8', {fatal:true}).decode(data)}));
    return await importSkillFolder(entries);
  } catch {invalid();}
}
