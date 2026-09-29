import test from 'node:test';
import assert from 'node:assert/strict';
import {isPlanCommand,planTools,planToolAllowed,planningRequest,PLAN_MODE_GUIDANCE} from '../plan-mode.js';
import {promptPreamble,SYSTEM_PROMPT} from '../chat-contract.js';
import {skillCommand,skillCommandOptions,resolveSkillCommand} from '../skill-command.js';
test('plan is an explicit standalone command, reserved from skill names',()=>{
 for(const text of ['/plan','/plan 업무 기록',' /PLAN\n화면 확인 '])assert(isPlanCommand(text));
 for(const text of ['설명 /plan','/planner','/plan/실행'])assert(!isPlanCommand(text));
 assert.equal(skillCommand({name:'plan'}),'skill-plan');assert.equal(resolveSkillCommand([],'/plan 업무'),null);
 assert.equal(skillCommandOptions([],'/pl')[0].command,'plan');
 assert(planningRequest('/plan FP 480분 작성').includes('FP 480분 작성'));
 assert(planningRequest('/plan').includes('현재 화면에서 진행할 업무'));
});
test('plan allowlist denies all action, script, MCP and approval paths, including future unknown tools',()=>{
 const reads=['read_page','browser_snapshot','inspect_dom','verify_page','capture_page','find_skills','read_skill','read_document','wiki_query','search_site_wiki','ask_user','update_plan'];
 const denied=['fill_form','click_element','hover_element','press_key','select_option','navigate_page','switch_tab','go_back','run_playwright','run_skill_script','call_mcp_tool','apply_approved_mcp','apply_approved_action','export_voc','attach_images','arbitrary_read_named_tool'];
 for(const name of reads)assert(planToolAllowed(name),name);
 for(const name of denied)assert(!planToolAllowed(name),name);
 assert.deepEqual(planTools([...reads,...denied].map(name=>({function:{name}}))).map(t=>t.function.name),reads);
});
test('mode contract is injected only by host state and does not replace original context',()=>{
 const regular=promptPreamble('qwen',new Date(),{}),plan=promptPreamble('qwen',new Date(),{planningOnly:true});
 assert(!regular[0].content.includes(PLAN_MODE_GUIDANCE));assert(plan[0].content.includes(PLAN_MODE_GUIDANCE));
 assert(plan[0].content.startsWith(SYSTEM_PROMPT));
});
