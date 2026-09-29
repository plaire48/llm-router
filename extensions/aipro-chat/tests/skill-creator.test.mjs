import test from 'node:test';
import assert from 'node:assert/strict';
import {skillCreationSource, creationSessionContext, continueSkillCreation, saveSkillDraft, skillCreationMessages, parseSkillDraft} from '../skill-creator.js';
import {exportSkill, importSkill} from '../skills.js';
const draft = {name:'업무 초안',description:'업무 기록을 작성할 때',instructions:'references/procedure.md를 읽고 수행합니다.',terms:'단위는 작성 필요',inputs:'{{업무날짜}}, {{투입시간}}, {{업무내용}}',procedure:'화면을 읽고 입력한 뒤 확인합니다.',checks:'값과 단위를 확인하고 등록하지 않습니다.'};
test('creator references only current-session user statements, with corrections and no imported history or secrets', () => {
 const value = {sessionId:'current', messages:[
  {id:'u1',role:'user',content:'투입 시간은 480분입니다.'},
  {role:'assistant',content:'Unverified generated claim'},
  {role:'user',contextOnly:true,content:'Internal compression request'},
  {id:'u2',role:'user',content:'정정합니다. 240분으로 작성하고 등록하지 마세요. token=secret'},
 ], chatHistory:[{messages:[{role:'user',content:'Other conversation'}]}]};
 const context=creationSessionContext(value);
 assert.equal(context.conversationId,'current');
 assert.deepEqual(context.statements.map(item=>item.messageId),['u1','u2']);
 assert.match(context.statements[1].text,/240분.*등록하지/);
 assert(!JSON.stringify(context).includes('secret'));
 assert(!JSON.stringify(context).includes('Other conversation'));
 assert(!JSON.stringify(context).includes('Unverified generated claim'));
 assert.equal(context.omittedMessages,0);
});
test('creator context preserves whole statements under a bounded budget and explicitly counts omissions', () => {
 const messages=Array.from({length:20},(_,i)=>({id:String(i),role:'user',content:`규칙 ${i}: 등록하지 마세요.`}));
 messages.push({id:'large',role:'user',content:'x'.repeat(6100)+' 등록하지 마세요.'});
 const context=creationSessionContext({sessionId:'current',messages});
 assert.equal(context.statements.length,12);
 assert.equal(context.omittedMessages,9);
 assert.deepEqual(context.statements.map(item=>item.messageId),messages.slice(8,20).map(item=>item.id));
 assert(context.statements.reduce((total,item)=>total+item.text.length,0)<=6000);
 assert(context.statements.every(item=>item.text.endsWith('등록하지 마세요.')));
});
const chat = () => ({messages:[{id:'u',role:'user',content:'업무 초안'}, {id:'r',requestId:'r',role:'assistant',state:'done',content:'초안 확인. user@company.test token=secret https://example.test/private?code=secret',trace:[{tool:'read_page',status:'done'},{tool:'click_element',status:'error',reason:'target_missing'},{tool:'fill_form',status:'done'},{tool:'verify_page',status:'done'}]}],task:{requestId:'r',goal:'초안을 작성해줘',status:'done',verification:{status:'passed'},plan:[{text:'초안 작성',status:'completed'}],page:{url:'https://example.test/private?code=secret'}}});
test('creator uses bounded task receipts, strips common secrets, and retains failed attempts as failures',()=>{
 const source=skillCreationSource(chat()); assert.equal(source.site,'https://example.test'); assert.equal(source.steps[1].status,'error'); assert.equal(source.verification,'passed'); assert(!JSON.stringify(source).includes('secret')); assert(!JSON.stringify(source).includes('user@company.test'));
 const messages=skillCreationMessages(source); assert.match(messages[0].content,/UNTESTED/); assert.match(messages[0].content,/never infer what FP/); assert.equal(messages.length,2);
});
test('no skill creation from conversation only, pending work, or fabricated task completion without browser receipts',()=>{
 for(const value of [{messages:[]}, {...chat(),task:{...chat().task,status:'paused'}}, {...chat(),messages:[{...chat().messages[1],trace:[{tool:'update_plan',status:'done'}]}]}]) assert.throws(()=>skillCreationSource(value),/skill_source_missing/);
});
test('draft schema rejects malformed, incomplete, huge or executable packages; sharing contains references only',()=>{
 for(const value of ['invalid',JSON.stringify({...draft,checks:''}),JSON.stringify({...draft,name:'x'.repeat(65)}),JSON.stringify({...draft,scripts:['execute']}),JSON.stringify(null)]) assert.throws(()=>parseSkillDraft(value),/skill_draft_invalid/);
 const skill=parseSkillDraft('```json\n'+JSON.stringify(draft)+'\n```'); assert.equal(skill.toolMode,'automatic'); assert.equal(skill.resources.length,4); assert(skill.resources.every(r=>r.path.startsWith('references/'))); assert.match(skill.instructions,/검토가 필요한 초안/);
 const imported=importSkill(exportSkill(skill)); assert.deepEqual(imported.resources,skill.resources); assert(!exportSkill(skill).includes('sourceId'));
});
test('creating another draft keeps the completed browser task as its source and never treats a generated draft as execution',()=>{
 const state=chat(); state.messages.push({id:'d',role:'assistant',state:'done',skillDraft:{skill:parseSkillDraft(JSON.stringify(draft))},content:'스킬 초안'}); assert.equal(skillCreationSource(state).sourceId,'r');
});

test('confirmed answers persist in the source, are bounded and do not authorize browser actions',()=>{
 const first=continueSkillCreation(skillCreationSource(chat()),'완료 안내','검토 요청');
 const second=continueSkillCreation(first,'업무 유형','내부 업무');
 assert.equal(second.answers.length,2); assert.equal(second.answers[0].answer,'검토 요청');
 assert.match(skillCreationMessages(second)[0].content,/Clarification does not authorize/);
 assert.throws(()=>continueSkillCreation(first,'질문',''),/skill_draft_invalid/);
 assert.throws(()=>continueSkillCreation(first,'질문','a'.repeat(4001)),/skill_answer_too_long/);
});

test('failed generation retries preserve confirmed answers only for the same source task',()=>{
 const state=chat(), source=continueSkillCreation(skillCreationSource(state),'완료 안내','검토 요청');
 state.messages.push({id:'failed',role:'assistant',state:'error',creatingSkill:true,creationSource:source});
 assert.deepEqual(skillCreationSource(state).answers,source.answers);
 state.task.requestId='new'; state.messages.push({...chat().messages[1],id:'new',requestId:'new'});
 assert.equal(skillCreationSource(state).answers,undefined);
});

test('saving a reviewed draft updates the conversation artifact, not its execution verification',()=>{
 const state=chat(); state.messages.push({id:'draft',creatingSkill:true,skillDraft:{sourceId:'r',status:'draft',skill:parseSkillDraft(JSON.stringify(draft))}});
 const next=saveSkillDraft(state,'draft',{...parseSkillDraft(JSON.stringify(draft)),name:'검토한 스킬'});
 assert.equal(next.messages.at(-1).skillDraft.saved,true); assert.equal(next.messages.at(-1).skillDraft.skill.name,'검토한 스킬');
 assert.equal(next.messages.at(-1).skillDraft.status,'draft'); assert(!state.messages.at(-1).skillDraft.saved);
 assert.throws(()=>saveSkillDraft(state,'wrong',draft),/skill_draft_invalid/);
});
