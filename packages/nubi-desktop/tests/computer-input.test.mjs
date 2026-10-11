// Keyboard, scroll and wheel input on the connected window (user decision 2026-09-30: every mouse and keyboard
// operation, each approved on its own). The adapter is the real one; only the winapp command runner is a fixture.
import {featureTest} from './beta-feature.mjs';
const test=featureTest('computerUse');
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {fixture} from './fixtures.mjs';
import {WinappComputer,observeComputer,proposeComputerAction,proposeComputerBatch} from '../runtime/computer-use.mjs';
import {readComputerResult,computerCheckpoint} from '../runtime/computer-harness.mjs';
import {parseKeys,textProblem,typedTextPresent} from '../runtime/computer-keys.mjs';
import {computerInstruction} from '../runtime/tool-feedback.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installAgent(ProjectService);

async function setup(t){
  const {service}=await fixture(t),task=await service.createTask({request:'앱에서 검색어를 입력한다.'});
  const status={hwnd:100,processId:42,processName:'Fixture',windowTitle:'Test app',windowDpi:96,scale:1,coordinateSpace:'physical-screen-pixels'};
  const field={selector:'txt-search',name:'검색',type:'Edit',isEnabled:true,isOffscreen:false,x:20,y:20,width:200,height:30,isInvokable:false};
  const list={selector:'lst-items',name:'목록',type:'List',isEnabled:true,isOffscreen:false,x:20,y:60,width:200,height:200,isInvokable:false};
  const row={selector:'row-40',name:'항목 40',type:'ListItem',isEnabled:true,isOffscreen:true,x:20,y:900,width:200,height:30,isInvokable:true};
  const data={status,elements:[field,list,row],values:{'txt-search':'주문 '},properties:{},password:{},focus:'txt-search',calls:[],acted:0};
  const find=selector=>data.elements.find(v=>v.selector===selector);
  const runner=async args=>{
    data.calls.push(args);const command=args[1];
    if(command==='status')return {...status};
    if(command==='inspect')return {windows:[{hwnd:100,elements:data.elements.map(v=>({...v}))}]};
    if(command==='get-property'){const v=find(args[2]);if(!v)throw Error('not found');return {elementId:v.selector,element:{...v},properties:{IsPassword:data.password[v.selector]||'False',IsReadOnly:'False',...data.properties[v.selector]}};}
    if(command==='get-value'){if(!(args[2] in data.values))throw Error('no value');return {elementId:args[2],text:data.values[args[2]]};}
    if(command==='get-focused'){const v=find(data.focus);return v?{hasFocus:true,element:{...v}}:{hasFocus:false};}
    if(command==='screenshot'){
      const v=args[2]==='--capture-screen'?{width:400,height:300}:find(args[2]),png=new PNG({width:v.width,height:v.height});png.data.fill(200+data.acted);
      const file=args[args.indexOf('--output')+1];await writeFile(file,PNG.sync.write(png));
      return {hwnd:100,elementId:args[2]==='--capture-screen'?null:args[2],filePath:file,width:v.width,height:v.height};
    }
    data.acted++;
    if(command==='send-keys'){
      const target=args[args.indexOf('--target')+1];data.focus=target;
      if(args.includes('--verbatim'))data.values[target]+=args[2];else data.keys=(data.keys||[]).concat(args[2]);
    }
    if(command==='scroll'&&args.includes('--direction'))data.properties['lst-items']={...data.properties['lst-items'],ScrollVerticalPercent:'50'};
    if(command==='scroll-into-view'){const v=find(args[2]);Object.assign(v,{isOffscreen:false,y:200});}
    return {ok:true};
  };
  service.computerAdapter=new WinappComputer({platform:'win32',runner});
  await service.computer({method:'bind',taskId:task.id,window:100});
  const propose=async(selector,action,extra={})=>{
    const observation=await observeComputer(service,task.id,{includeImage:false});
    return proposeComputerAction(service,task.id,{observationId:observation.observationId,selector,action,reason:'요청한 입력',...extra});
  };
  const decide=(p,consent={})=>service.computer({method:'decide',taskId:task.id,id:p.id,fingerprint:p.fingerprint,decision:'approve',...consent});
  return {service,task,data,propose,decide};
}

test('keys are read in the grammar of send-keys; system keys and bare letters are refused',()=>{
  assert.deepEqual(parseKeys('Ctrl+S'),{keys:'ctrl+s',tokens:['ctrl+s']});
  assert.deepEqual(parseKeys('down  down Enter'),{keys:'down down enter',tokens:['down','down','enter']});
  assert.deepEqual(parseKeys('alt+shift+tab').problem,'keys_system');
  assert.equal(parseKeys('shift+Tab').keys,'shift+tab');assert.equal(parseKeys('Escape').keys,'esc');assert.equal(parseKeys('ctrl+shift+t').keys,'ctrl+shift+t');
  for(const keys of ['win+r','alt+tab','alt+f4','ctrl+esc','ctrl+shift+esc','ctrl+alt+delete','ctrl+alt+t','alt+space','meta+l'])assert.equal(parseKeys(keys).problem,'keys_system',keys);
  for(const keys of ['a','shift+a','7'])assert.equal(parseKeys(keys).problem,'keys_text',keys);
  for(const keys of ['','ctrl+','capslock','vk=0x42','text=enter','ctrl+ctrl+s','f13',Array(11).fill('tab').join(' ')])assert.ok(parseKeys(keys).problem,keys);
  assert.equal(textProblem('주문 SKU-0613'),null);
  for(const [text,problem] of [['',"text_invalid"],['a\nb','text_control_character'],['-5','text_leading_dash'],['x'.repeat(1001),'text_invalid']])assert.equal(textProblem(text),problem);
  assert.ok(typedTextPresent('금액 150,000원','150000'));assert.ok(!typedTextPresent('다른 값','150000'));
});

test('typed text needs keyboard consent, goes to its target with send-input and is read back',async t=>{
  const {service,task,data,propose,decide}=await setup(t);
  const p=await propose('txt-search','type_text',{value:'SKU-0613'});
  assert.equal(p.inputMode,'keyboard');assert.equal(data.acted,0);
  await assert.rejects(decide(p),/computer_keyboard_consent_required/);await assert.rejects(decide(p,{pointerConsent:true}),/computer_keyboard_consent_required/);assert.equal(data.acted,0);
  await decide(p,{keyboardConsent:true});await decide(p,{keyboardConsent:true});assert.equal(data.acted,1);
  assert.deepEqual(data.calls.find(v=>v[1]==='send-keys'),['ui','send-keys','SKU-0613','--verbatim','--target','txt-search','--via','send-input','-w','100','--json']);
  assert.ok(!data.calls.some(v=>v.includes('--allow-system-keys')));
  const receipt=readComputerResult(service,task.id,{actionId:p.id}).receipt;
  assert.equal(receipt.verification,'text_present');assert.equal(receipt.keyboardApproval.scope,'one_action');assert.equal(receipt.focus.selector,'txt-search');
  assert.equal(data.values['txt-search'],'주문 SKU-0613');
});

test('a user edit between proposal and approval stops typed text; a password field takes no keys',async t=>{
  const {service,data,propose,decide}=await setup(t);
  const p=await propose('txt-search','type_text',{value:'SKU'});data.values['txt-search']='사람이 고친 값';
  await decide(p,{keyboardConsent:true});assert.equal(data.acted,0);assert.equal(service.store.get('computer-action:'+p.id).state,'stale');
  data.password['txt-search']='True';
  await assert.rejects(propose('txt-search','type_text',{value:'secret'}),/computer_input_unavailable/);
  await assert.rejects(propose('txt-search','press_keys',{keys:'enter'}),/computer_input_unavailable/);
  data.password['txt-search']=undefined;
  await assert.rejects(propose('txt-search','type_text',{value:'줄\n바꿈'}),error=>error.message==='computer_text_invalid'&&error.details.problem==='text_control_character');
  assert.equal(data.acted,0);
});

test('keys are sent in their normal form; system keys never reach the app',async t=>{
  const {service,task,data,propose,decide}=await setup(t);
  const refused=await propose('txt-search','press_keys',{keys:'Alt+Tab'}).then(()=>null,error=>error);
  assert.equal(refused.message,'computer_keys_refused');assert.deepEqual(refused.details,{problem:'keys_system',token:'alt+tab'});
  assert.match(computerInstruction('computer_keys_refused'),/never sent/);
  const letter=await propose('txt-search','press_keys',{keys:'a'}).then(()=>null,error=>error);
  assert.equal(letter.message,'computer_keys_invalid');assert.equal(letter.details.problem,'keys_text');assert.match(computerInstruction('computer_keys_invalid'),/type_text/);
  const p=await propose('txt-search','press_keys',{keys:'Ctrl+S'});assert.equal(p.keys,'ctrl+s');
  await decide(p,{keyboardConsent:true});
  assert.deepEqual(data.calls.find(v=>v[1]==='send-keys'),['ui','send-keys','ctrl+s','--target','txt-search','--via','send-input','-w','100','--json']);
  const receipt=readComputerResult(service,task.id,{actionId:p.id}).receipt;assert.equal(receipt.keys,'ctrl+s');assert.equal(receipt.verification,'not_verified');
  // A record changed after approval cannot smuggle other keys through the adapter.
  await assert.rejects(service.computerAdapter.act(100,'txt-search','press_keys',undefined,{keyboardConsent:true,keys:'alt+f4'}),/computer_invalid/);
});

test('scroll is UIA on a list that says it scrolls, and its receipt compares the position',async t=>{
  const {service,task,data,propose,decide}=await setup(t);
  await assert.rejects(propose('lst-items','scroll',{direction:'down'}),error=>error.message==='computer_target_unavailable'&&error.details.reason==='not_scrollable');
  data.properties['lst-items']={VerticallyScrollable:'True',ScrollVerticalPercent:'0',HorizontallyScrollable:'False',ScrollHorizontalPercent:'-1'};
  const observed=await observeComputer(service,task.id,{selector:'lst-items',includeImage:false});
  assert.deepEqual(observed.target.controlState.scroll,{vertical:0,horizontal:null,verticallyScrollable:true,horizontallyScrollable:false});
  await assert.rejects(propose('lst-items','scroll',{direction:'left'}),/computer_target_unavailable/);
  const p=await propose('lst-items','scroll',{direction:'down'});assert.equal(p.inputMode,'uia');
  await decide(p);assert.deepEqual(data.calls.find(v=>v[1]==='scroll'),['ui','scroll','lst-items','--direction','down','-w','100','--json']);
  const receipt=readComputerResult(service,task.id,{actionId:p.id}).receipt;
  assert.equal(receipt.verification,'scrolled');assert.deepEqual([receipt.scrollCheck.before,receipt.scrollCheck.after],[0,50]);
  assert.ok(!data.calls.some(v=>['click','hover','send-keys','drag'].includes(v[1])));
});

test('a control off the screen is brought into view, and only then takes other input',async t=>{
  const {service,task,data,propose,decide}=await setup(t);
  await assert.rejects(propose('row-40','invoke'),error=>error.details?.reason==='off_screen');
  assert.match(computerInstruction('computer_target_unavailable'),/scroll_into_view/);
  const p=await propose('row-40','scroll_into_view');await decide(p);
  assert.deepEqual(data.calls.find(v=>v[1]==='scroll-into-view'),['ui','scroll-into-view','row-40','-w','100','--json']);
  assert.equal(readComputerResult(service,task.id,{actionId:p.id}).receipt.verification,'in_view');
  const q=await propose('row-40','invoke');assert.equal(q.state,'proposed');
  await service.computer({method:'decide',taskId:task.id,id:q.id,fingerprint:q.fingerprint,decision:'reject'});
  // Already in view: nothing is sent.
  const r=await propose('row-40','scroll_into_view');await decide(r);assert.equal(service.store.get('computer-action:'+r.id).execution,'already_at_target');
});

test('the wheel is real mouse input with its own consent',async t=>{
  const {data,propose,decide}=await setup(t);
  await assert.rejects(propose('lst-items','wheel',{direction:'left'}),/computer_invalid/);
  await assert.rejects(propose('lst-items','wheel'),/computer_invalid/);
  const p=await propose('lst-items','wheel',{direction:'down',amount:3});assert.equal(p.inputMode,'shared_pointer');assert.equal(p.pointerBasis,'gesture');
  await assert.rejects(decide(p),/computer_pointer_consent_required/);
  await decide(p,{pointerConsent:true});assert.deepEqual(data.calls.find(v=>v[1]==='scroll'),['ui','scroll','lst-items','--wheel','-3','-w','100','--json']);
});

test('text typed and sent with Enter is one batch with keyboard consent; keys come last',async t=>{
  const {service,task,data}=await setup(t);
  const observation=await observeComputer(service,task.id,{includeImage:false});
  const batch=steps=>proposeComputerBatch(service,task.id,{observationId:observation.observationId,reason:'검색',steps});
  const early=await batch([{selector:'txt-search',action:'press_keys',keys:'enter'},{selector:'lst-items',action:'invoke'}]).then(()=>null,error=>error);
  assert.deepEqual(early.details.problems.map(item=>item.problem),['press_keys_is_the_last_step']);
  const system=await batch([{selector:'txt-search',action:'type_text',value:'x'},{selector:'lst-items',action:'press_keys',keys:'win+d'}]).then(()=>null,error=>error);
  assert.deepEqual(system.details.problems,[{step:2,problem:'keys_refused'}]);
  data.properties['lst-items']={VerticallyScrollable:'True',ScrollVerticalPercent:'0'};
  const p=await batch([{selector:'txt-search',action:'type_text',value:'SKU-0613'},{selector:'lst-items',action:'press_keys',keys:'Enter'}]);
  assert.equal(p.inputMode,'keyboard');assert.equal(p.steps[1].keys,'enter');
  const decide=consent=>service.computer({method:'decide',taskId:task.id,id:p.id,fingerprint:p.fingerprint,decision:'approve',...consent});
  await assert.rejects(decide({}),/computer_keyboard_consent_required/);assert.equal(data.acted,0);
  await decide({keyboardConsent:true});
  assert.deepEqual(data.calls.filter(v=>v[1]==='send-keys').map(v=>v.slice(2,5)),[['SKU-0613','--verbatim','--target'],['enter','--target','lst-items']]);
  const receipt=service.store.get('computer-action:'+p.id);assert.equal(receipt.verification,'steps_matched');assert.deepEqual(receipt.steps.map(step=>step.verification),['text_present','not_verified']);
});

// Found by review (2026-09-30).
test('Shift does not unlock a system key; paste and a key that moves focus before others are refused',()=>{
  for(const keys of ['alt+shift+f4','shift+alt+space','alt+shift+esc','ctrl+shift+esc','shift+ctrl+esc'])assert.equal(parseKeys(keys).problem,'keys_system',keys);
  for(const keys of ['ctrl+v','shift+insert','ctrl+shift+v','tab ctrl+v enter'])assert.ok(['keys_clipboard','keys_focus_not_last'].includes(parseKeys(keys).problem),keys);
  assert.equal(parseKeys('ctrl+v').problem,'keys_clipboard');
  for(const keys of ['tab down','enter ctrl+s','esc tab','ctrl+tab enter'])assert.equal(parseKeys(keys).problem,'keys_focus_not_last',keys);
  for(const keys of ['down down enter','ctrl+a delete','shift+tab','ctrl+s','home shift+end'])assert.equal(parseKeys(keys).problem,undefined,keys);
  assert.equal(textProblem('@options.txt'),'text_leading_at');
});

test('a value or search that starts with @ never reaches the command line; unchanged text is not typed text',async t=>{
  const {service,task,data,propose,decide}=await setup(t);
  await assert.rejects(propose('txt-search','set_value',{value:'@file'}),/computer_invalid/);
  await assert.rejects(observeComputer(service,task.id,{query:'@file',includeImage:false}),/computer_invalid/);
  await assert.rejects(propose('txt-search','press_keys',{keys:'tab down'}),error=>error.message==='computer_keys_invalid'&&error.details.problem==='keys_focus_not_last');
  await assert.rejects(propose('txt-search','press_keys',{keys:'ctrl+v'}),error=>error.message==='computer_keys_refused'&&error.details.problem==='keys_clipboard');
  // The text is already in the field and the keys went elsewhere: nothing shows that it was typed.
  data.values['txt-search']='주문 SKU-0613';
  const p=await propose('txt-search','type_text',{value:'SKU-0613'});
  const act=service.computerAdapter.runner;service.computerAdapter.runner=async args=>{if(args[1]==='send-keys'){data.calls.push(args);data.acted++;return {ok:true};}return act(args);};
  await decide(p,{keyboardConsent:true});
  assert.equal(readComputerResult(service,task.id,{actionId:p.id}).receipt.verification,'text_absent');
  assert.equal(data.acted,1);
});

// One observation reads several controls (2026-09-30): checking values after a batch took one call per control.
test('one observation reads the values and states of several controls, never a password',async t=>{
  const {service,task,data}=await setup(t);
  data.password['lst-items']='True';data.properties['lst-items']={VerticallyScrollable:'True',ScrollVerticalPercent:'0'};
  const seen=await observeComputer(service,task.id,{selectors:['txt-search','lst-items','no-such-control'],includeImage:false});
  assert.deepEqual(seen.targets.map(item=>[item.selector,item.value??null,item.password??false,item.found??true]),[['txt-search','주문 ',false,true],['lst-items',null,true,true],['no-such-control',null,false,false]]);
  assert.equal(seen.targets[1].controlState.scroll.verticallyScrollable,true);
  assert.equal(data.calls.filter(args=>args[1]==='get-value').length,1,'a password is never read');
  for(const bad of [{selectors:[]},{selectors:Array(11).fill('x').map((_,i)=>'c'+i)},{selectors:['a','a']},{selectors:['10,20']},{selectors:['txt-search'],selector:'txt-search'}])
    await assert.rejects(observeComputer(service,task.id,{...bad,includeImage:false}),/computer_invalid/,JSON.stringify(bad));
  assert.equal(data.acted,0);
});

// Found by the measurement (S26 A21): told only that a window was bound, the model asked for a connection it had.
test('the host receipts name the connected window, and nothing when none is connected',async t=>{
  const {service,task}=await setup(t);
  assert.deepEqual(computerCheckpoint(service,task.id).window,{title:'Test app',processName:'Fixture'});
  await service.computer({method:'unbind',taskId:task.id});
  const unbound=computerCheckpoint(service,task.id);assert.equal(unbound.bound,false);assert.equal(unbound.window,undefined);
});
