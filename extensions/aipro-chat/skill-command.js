// A portable name, never a script or an authorization grant.
export function skillCommand(skill, reserved = ['compact','wiki','plan']) {
  const name = String(skill?.name || '').normalize('NFKC').toLowerCase().trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'skill';
  return reserved.includes(name) ? `skill-${name}` : name;
}
export function skillCommandOptions(skills, text) {
  const match = /^\/([^\s/]*)$/.exec(text);
  if (!match) return [];
  const query = match[1].normalize('NFKC').toLowerCase();
  return [{id:'builtin-wiki',name:'사이트 위키 만들기',description:'현재 화면을 읽고 재사용할 문서 초안을 만듭니다.'},{id:'builtin-plan',name:'계획만 검토',description:'현재 화면과 문서를 읽어 실행 전 절차를 정리합니다.'},...skills].map(skill => ({skill, command:skill.id === 'builtin-wiki' ? 'wiki' : skill.id === 'builtin-plan' ? 'plan' : skillCommand(skill)})).filter(item => item.command.includes(query));
}
export function resolveSkillCommand(skills, text) {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match || ['compact','wiki','plan'].includes(match[1])) return null;
  const found = skills.filter(skill => skillCommand(skill) === match[1].normalize('NFKC').toLowerCase());
  if (found.length !== 1) throw new Error(found.length ? 'skill_command_ambiguous' : 'skill_command_missing');
  return {skill:found[0], input:match[2]?.trim() || `${found[0].name} 절차를 시작해 주세요. 필요한 정보가 없으면 질문으로 확인해 주세요.`};
}
