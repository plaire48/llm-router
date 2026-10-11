// Shared registration contract. A document skill defines writing requirements,
// never tools, credentials, native scope, or permission to execute code.
const fail=()=>{throw new Error('document_skill_invalid');};
const text=(v,n)=>typeof v==='string'&&v.trim()&&v.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
export function documentSkill(value,host){
  if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['id','host','revision','name','instructions','questions','package'].includes(k)))fail();
  if(!['excel','word','powerpoint'].includes(host)||value.host!==host||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(value.id)||!Number.isInteger(value.revision)||value.revision<1||value.revision>2147483647||!text(value.name,100)||!text(value.instructions,8000)||!Array.isArray(value.questions)||value.questions.length>8)fail();
  if(value.package!==undefined){
    const p=value.package;
    if(!p||Object.keys(p).some(k=>!['version','sha256','fileCount','totalBytes'].includes(k))||p.version!==1||! /^[a-f0-9]{64}$/.test(p.sha256||'')||!Number.isInteger(p.fileCount)||p.fileCount<1||p.fileCount>256||!Number.isInteger(p.totalBytes)||p.totalBytes<1||p.totalBytes>8388608||value.questions.length)fail();
  }
  const seen=new Set();
  for(const q of value.questions){
    if(!q||Object.keys(q).some(k=>!['question','choices','input_mode'].includes(k))||!text(q.question,180)||seen.has(q.question.trim())||!['text','long_text'].includes(q.input_mode)||!Array.isArray(q.choices)||q.choices.length===1||q.choices.length>4)fail();
    seen.add(q.question.trim());const choices=new Set();
    for(const c of q.choices){if(!c||Object.keys(c).some(k=>k!=='label')||!text(c.label,80)||choices.has(c.label.trim()))fail();choices.add(c.label.trim());}
  }
  return structuredClone(value);
}
export const SKILL_INPUT_GUIDANCE = 'NUBI_SKILL_INPUT_POLICY. Minimize user setup. Choose relevant skills, tools, layout and question presentation yourself. Treat requiredInputs as information requirements, not a fixed questionnaire. First inspect the current request, relevant original user messages, explicit answers and available bound document evidence; retrieve omitted context before asking again. Distinguish observed document facts from user instructions. Never use assistant claims, skill examples, defaults or stale answers as business facts. previousAnswers are earlier explicit user answers, not current-task facts by default. Reuse only applicable explicit facts without asking again; current corrections take precedence. Never label model deductions as user answers. Existing question choices are presentation hints, never default facts. If an essential fact is missing, contradictory or ambiguous, MUST ask with the existing ask_user or planner clarify form before dependent writing. Choose 2-4 grounded choices when known, otherwise free text; users never need to configure input_mode. A blank reusable template does not require instance values. Skill-required human decisions/confirmations cannot be inferred away. Include applicable skill rules and information requirements in the plan and final requirements review; unknown facts cannot pass as complete. Use existing read-only subagents only for useful independent source analysis; they cannot invent facts, ask separate forms, grant permission or perform native writes. If delegation returns context_range_limit, narrow source ranges; if exact active skill rules still do not fit, continue with parent tools under the same rules instead of dropping instructions or repeating unchanged delegation. Keep all original requirements and explicit answers through compaction. Skill activation and user information are never write, save or Python approval.';
export function documentSkillMarkdown(skill){
  return `---\nname: document-${skill.id}\ndescription: ${JSON.stringify(skill.name)}\n---\n\n# ${skill.name}\n\n${skill.instructions}\n\n## Information requirements\n\n${skill.questions.map(q=>'- '+q.question).join('\n')}\n\nResolve these requirements from current evidence. Ask only missing essential facts, not every listed question. Prior answers require current-task relevance. Never infer human approvals.\n`;
}
