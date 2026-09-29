import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync, strToU8, unzipSync} from 'fflate';
import {exportSkillArchive, importSkillArchive} from '../skill-archive.js';
import {skillCommand, skillCommandOptions, resolveSkillCommand} from '../skill-command.js';
const skill={id:'custom-test',name:'FP 업무 초안',description:'내부 규칙에 따른 초안',instructions:'용어와 입력 정보를 확인합니다.',toolMode:'automatic',resources:[{path:'references/terms.md',content:'FP: 조직별 정의를 작성하세요.'},{path:'scripts/check.browser.js',content:'return await browser.snapshot();'}]};
test('ZIP contains portable SKILL.md and references, preserves scripts as text without runtime state',async()=>{
 const bytes=exportSkillArchive({...skill,token:'private-token',history:'private-history'});
 const files=unzipSync(bytes); assert.equal(Object.keys(files).length,3); assert(Object.keys(files).some(key=>key.endsWith('/SKILL.md')));
 const imported=await importSkillArchive(bytes); assert.equal(imported.name,skill.name); assert.deepEqual(imported.resources,skill.resources); assert(!JSON.stringify(imported).includes('private-token')); assert.notEqual(imported.id,skill.id);
});
test('ZIP rejects traversal, duplicate paths, unsupported files, extra roots, invalid UTF-8 and inflated size before import',async()=>{
 const md=strToU8('---\nname: example\ndescription: test\n---\nTask');
 for(const entries of [{ '../SKILL.md':md }, {'SKILL.md':md,'references/a.md':md,'references/A.md':md}, {'SKILL.md':md,'other/SKILL.md':md}, {'SKILL.md':md,'app.exe':md}, {'SKILL.md':md,'references/a.md':new Uint8Array([0xff])}, {'SKILL.md':md,'references/huge.md':new Uint8Array(3000000)}]) {
  await assert.rejects(()=>importSkillArchive(zipSync(entries)),/skill_archive_invalid/);
 }
 await assert.rejects(()=>importSkillArchive(new Uint8Array(216001)),/skill_archive_invalid/);
});
test('commands are portable, exact and task-scoped; missing/ambiguous commands never choose a different skill',()=>{
 assert.equal(skillCommand(skill),'fp-업무-초안'); assert.equal(skillCommand({name:'compact'}),'skill-compact');
 assert.equal(skillCommandOptions([skill],'/fp')[0].skill.id,skill.id); assert.equal(skillCommandOptions([skill],'/fp-업무-초안 새 요청').length,0);
 const selected=resolveSkillCommand([skill],'/fp-업무-초안 초안만 작성'); assert.equal(selected.skill.id,skill.id); assert.equal(selected.input,'초안만 작성');
 assert.match(resolveSkillCommand([skill],'/fp-업무-초안').input,/질문/); assert.equal(resolveSkillCommand([skill],'/compact'),null);
 assert.throws(()=>resolveSkillCommand([skill],'/missing'),/skill_command_missing/);
 assert.throws(()=>resolveSkillCommand([skill,{...skill,id:'custom-other'}],'/fp-업무-초안'),/skill_command_ambiguous/);
});
