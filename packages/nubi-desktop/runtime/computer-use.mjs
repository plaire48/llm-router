import {QUESTION_TEXT_LIMIT} from '../../../extensions/aipro-chat/user-question.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,stat,mkdtemp,rm,realpath} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';
import {fail,hash} from './files.mjs';
import {WindowsApps,appEnvironment} from './windows-apps.mjs';
import {reviewComputerResult,observedEffect} from './computer-harness.mjs';
import {CONTROL_ACTIONS,POINTER_ACTIONS,KEYBOARD_ACTIONS,SCROLL_DIRECTIONS,controlState,expectedControlState,supportsControlAction,checkControlState,checkScroll} from './computer-controls.mjs';
import {parseKeys,textProblem,typedTextPresent} from './computer-keys.mjs';
import {validateWikiEvidence} from './wiki-evidence.mjs';
import {ComputerPointer} from './computer-pointer.mjs';
import {recordUiaFailure,fallbackStatus} from './computer-fallback.mjs';
import {documentSnapshot,DOCUMENT_LIMITS} from './workspace-documents.mjs';
import {LocalPerception,groundWithConnectedModel,OUTCOME_SCHEMA,outcomeReflection} from './computer-perception.mjs';
import {DESKTOP_FEATURES} from './beta-features.mjs';

const exec=promisify(execFile), TTL=120000, STATED_MATCHES=5;
// Elements of one tree observation. At 150 a settings screen of about 200 controls hid its last section (case A16);
// the model windows are 256K to 512K (user decision 2026-09-30).
export const INSPECT_ELEMENTS=400,INSPECT_VISITS=3000;
const text=maxLength=>({type:'string',minLength:1,maxLength});
export const COMPUTER_ACTION_SCHEMA={type:'object',additionalProperties:false,properties:{observationId:text(80),selector:text(300),destinationSelector:text(300),action:{enum:[...CONTROL_ACTIONS,...POINTER_ACTIONS,...KEYBOARD_ACTIONS],type:'string'},value:{type:'string',maxLength:4000},keys:text(200),direction:{type:'string',enum:[...SCROLL_DIRECTIONS]},amount:{type:'integer',minimum:1,maximum:10},reason:text(500),documentAnalysisId:text(80),evidenceIds:{type:'array',maxItems:10,uniqueItems:true,items:text(300)}},required:['observationId','selector','action','reason']};
const validate=new Ajv().compile(COMPUTER_ACTION_SCHEMA);
// One approval for 2 to 5 inputs of one window: UIA inputs, typed text and keys (a search typed and sent with Enter).
// Mouse input stays with the single proposal and its separate consent.
export const BATCH_ACTIONS=Object.freeze(['set_value','select','toggle_on','toggle_off','expand','collapse','invoke','type_text','press_keys']);
export const COMPUTER_BATCH_SCHEMA={type:'object',additionalProperties:false,properties:{observationId:text(80),reason:text(500),steps:{type:'array',minItems:2,maxItems:5,items:{type:'object',additionalProperties:false,properties:{selector:text(300),action:{enum:[...BATCH_ACTIONS],type:'string'},value:{type:'string',maxLength:4000},keys:text(200)},required:['selector','action']}},documentAnalysisId:text(80),evidenceIds:{type:'array',maxItems:10,uniqueItems:true,items:text(300)}},required:['observationId','reason','steps']};
const validateBatch=new Ajv().compile(COMPUTER_BATCH_SCHEMA);
const validateOutcome=new Ajv().compile(OUTCOME_SCHEMA);
let desktopOwner=null;
const stamp=()=>new Date().toISOString();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const validSelector=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,299}$/.test(v);
const hwnd=v=>Number.isSafeInteger(v)&&v>0;
export const winappEnvironment=(source,workflow)=>({...appEnvironment(source),WINAPP_UI_WORKFLOW_ID:workflow});
const windowIdentity=v=>({hwnd:v.hwnd,processId:v.processId,processName:v.processName,windowTitle:v.windowTitle,windowDpi:v.windowDpi,scale:v.scale,coordinateSpace:v.coordinateSpace});
function identity(v){
  if(!hwnd(v?.hwnd)||!hwnd(v.processId)||typeof v.processName!=='string'||typeof v.windowTitle!=='string'||!Number.isFinite(v.windowDpi)||v.windowDpi<=0||v.scale!==v.windowDpi/96||v.coordinateSpace!=='physical-screen-pixels')fail('computer_contract');
  return windowIdentity(v);
}
function element(v){
  if(!validSelector(v?.selector)||(v.name!=null&&typeof v.name!=='string')||typeof v.type!=='string'||typeof v.isEnabled!=='boolean'||typeof v.isOffscreen!=='boolean'||!['x','y','width','height'].every(k=>Number.isFinite(v[k])))fail('computer_contract');
  return {selector:v.selector,name:(v.name??'').slice(0,500),type:v.type,isEnabled:v.isEnabled,isOffscreen:v.isOffscreen,x:v.x,y:v.y,width:v.width,height:v.height,isInvokable:v.isInvokable===true};
}
// Input needs a control that is enabled and on the screen. Reading does not.
const onScreen=v=>!v.isOffscreen&&v.width>0&&v.height>0;
// scroll_into_view is the one input for a control that is off the screen.
function usable(v,{offscreen=false}={}){if(!v.isEnabled||!offscreen&&!onScreen(v))throw Object.assign(new Error('computer_target_unavailable'),{details:{reason:!v.isEnabled?'disabled':v.isOffscreen?'off_screen':'no_size'}});}
export function readPng(bytes){
  if(bytes.length>4500000||bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail('computer_image_invalid');
  const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);
  if(!w||!h||w*h>8000000)fail('computer_image_invalid');
  try{return PNG.sync.read(bytes);}catch{fail('computer_image_invalid');}
}
export function imageDifference(before,after){
  const a=readPng(Buffer.from(before.data,'base64')),b=readPng(Buffer.from(after.data,'base64'));
  if(a.width!==b.width||a.height!==b.height)return {state:'size_changed',verification:'not_verified'};
  return {state:'compared',changedPixels:pixelmatch(a.data,b.data,null,a.width,a.height,{threshold:0.1}),verification:'not_verified'};
}

// External Microsoft winapp preview adapter. Never resolve an executable from a project or PATH.
export class WinappComputer {
  constructor({platform=process.platform,binary=process.env.NUBI_WINAPP_PATH,digest=process.env.NUBI_WINAPP_SHA256,runner}={}){this.platform=platform;this.binary=binary;this.digest=digest;this.runner=runner;this.workflow='nubi-'+randomUUID();this.controller=new AbortController();}
  availability(){const available=this.platform==='win32'&&!!(this.runner||(this.binary&&path.isAbsolute(this.binary)&&/^[a-f0-9]{64}$/i.test(this.digest||'')));return {available,reason:available?null:this.platform!=='win32'?'windows_required':'winapp_setup_required'};}
  dispose(){this.controller.abort();}
  async call(args){
    if(this.controller.signal.aborted)fail('computer_cancelled');
    if(!this.availability().available)fail('computer_unavailable');
    if(!this.runner&&((await stat(this.binary)).size>300000000||createHash('sha256').update(await readFile(this.binary)).digest('hex')!==this.digest.toLowerCase()))fail('computer_binary_changed');
    try{
      if(this.runner){const value=await this.runner(['ui',...args,'--json']);if(value?.error)fail('computer_command_failed');return value;}
      const {stdout}=await exec(this.binary,['ui',...args,'--json'],{signal:this.controller.signal,cwd:os.tmpdir(),shell:false,windowsHide:true,timeout:20000,maxBuffer:3000000,env:winappEnvironment(process.env,this.workflow)});
      const value=JSON.parse(stdout);if(value?.error)fail('computer_command_failed');return value;
    }catch(error){
      // winapp search uses exit 1 for a valid empty result. Never generalize this to actions.
      if(args[0]==='search'&&error.code===1&&!error.killed&&!error.signal&&!String(error.stderr||'').trim()){
        try{const value=JSON.parse(error.stdout);if(value?.matchCount===0&&value.hasMore===false&&Array.isArray(value.matches)&&!value.matches.length&&!value.error)return value;}catch{}
      }
      fail('computer_command_failed');
    }
  }
  async windows(){const values=await this.call(['list-windows']);if(!Array.isArray(values))fail('computer_contract');return values.filter(v=>hwnd(v.hwnd)&&hwnd(v.processId)&&v.width>0&&v.height>0&&typeof v.processName==='string').slice(0,80).map(v=>({hwnd:v.hwnd,processId:v.processId,processName:v.processName,title:String(v.title||v.processName).slice(0,300)}));}
  async status(window){return identity(await this.call(['status','-w',String(window)]));}
  async inspect(window){
    const raw=await this.call(['inspect','-w',String(window),'--depth','5']);
    const selected=raw?.windows?.filter(v=>v.hwnd===window);if(selected?.length!==1)fail('computer_contract');
    const out=[];let visited=0;
    function walk(nodes,depth=0){if(!Array.isArray(nodes)||depth>10)return;for(const v of nodes){if(++visited>INSPECT_VISITS)return;if(v.selector&&out.length<INSPECT_ELEMENTS)out.push(element(v));walk(v.children,depth+1);}}
    walk(selected[0].elements);return {elements:out,truncated:out.length===INSPECT_ELEMENTS||visited>INSPECT_VISITS,coverage:{mode:'tree',depth:5,limit:INSPECT_ELEMENTS,complete:false}};
  }
  async search(window,query){
    if(typeof query!=='string'||!query.trim()||query.length>200||/^[-@]/.test(query.trimStart())||query.includes('\0'))fail('computer_invalid');
    const raw=await this.call(['search',query,'-w',String(window),'--max','20']);
    if(!Array.isArray(raw?.matches)||!Number.isInteger(raw.matchCount)||raw.matchCount!==raw.matches.length||raw.matchCount>20||typeof raw.hasMore!=='boolean')fail('computer_contract');
    const elements=raw.matches.map(element);
    if(new Set(elements.map(v=>v.selector)).size!==elements.length)fail('computer_contract');
    return {elements,truncated:raw.hasMore,coverage:{mode:'search',query,limit:20,complete:false}};
  }
  async property(window,selector){
    const raw=await this.call(['get-property',selector,'-w',String(window)]);
    // Tree inspection prefers AutomationId; single-element queries return a semantic slug.
    // Accept only an explicit alias on the resolved element, never an arbitrary ID mismatch.
    if(raw?.elementId!==raw?.element?.selector||!validSelector(raw?.element?.selector)||(raw.element.selector!==selector&&raw.element.automationId!==selector))fail('computer_target_changed');
    // UIA password flag is required for value read/write. Missing is not false.
    return {element:element({...raw.element,selector}),resolvedSelector:raw.element.selector,password:raw.properties?.IsPassword,readOnly:raw.properties?.IsReadOnly,controlState:controlState(raw.properties)};
  }
  async value(window,selector){const {resolvedSelector,password}=await this.property(window,selector);if(password!=='False')fail('computer_password');const result=await this.call(['get-value',resolvedSelector,'-w',String(window)]);if(result?.elementId!==resolvedSelector||typeof result.text!=='string'||result.text.length>4000)fail('computer_contract');return result.text;}
  async capture(window,selector){
    const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-capture-')),file=path.join(directory,'capture.png');
    try{
      const resolvedSelector=selector?(await this.property(window,selector)).resolvedSelector:null;
      const result=await this.call(['screenshot',...(resolvedSelector?[resolvedSelector]:['--capture-screen']),'-w',String(window),'--output',file]);
      if(result?.hwnd!==window||(result.elementId??null)!==resolvedSelector||typeof result.filePath!=='string'||!path.isAbsolute(result.filePath))fail('computer_contract');
      // Windows/.NET may expand RUNNER~1 to runneradmin. Compare actual files, not spelling.
      if(await realpath(result.filePath)!==await realpath(file))fail('computer_contract');
      if((await stat(file)).size>4500000)fail('computer_image_invalid');
      const bytes=await readFile(file),png=readPng(bytes);
      if(result.width!==png.width||result.height!==png.height)fail('computer_contract');
      return {mimeType:'image/png',data:bytes.toString('base64'),width:png.width,height:png.height,scope:selector?'element':'window_region',selector:selector||null};
    }finally{await rm(directory,{recursive:true,force:true});}
  }
  async act(window,selector,action,value,{pointerConsent=false,keyboardConsent=false,destinationSelector,keys,direction,amount}={}){
    if(POINTER_ACTIONS.includes(action)){
      if(pointerConsent!==true)fail('computer_pointer_consent_required');
      if(!validSelector(selector)||(action==='drag'&&!validSelector(destinationSelector)))fail('computer_invalid');
      if(action==='wheel'&&(!['up','down'].includes(direction)||!Number.isSafeInteger(amount)||amount<1||amount>10))fail('computer_invalid');
      // A wheel notch up is positive.
      const args=action==='drag'?['drag',selector,destinationSelector]:action==='hover'?['hover',selector,'--dwell-time','800']:action==='wheel'?['scroll',selector,'--wheel',String(direction==='up'?amount:-amount)]:['click',selector,...(action==='pointer_right_click'?['--right']:action==='pointer_double_click'?['--double']:[])];
      await this.call([...args,'-w',String(window)]);return;
    }
    if(KEYBOARD_ACTIONS.includes(action)){
      if(keyboardConsent!==true)fail('computer_keyboard_consent_required');
      // Checked again here: only approved keys in their normal form and literal text reach the command line.
      if(!validSelector(selector)||(action==='press_keys'?parseKeys(keys).keys!==keys:textProblem(value)!==null))fail('computer_invalid');
      // send-input reaches every kind of app, shortcuts included. System keys stay refused: never --allow-system-keys.
      await this.call(['send-keys',...(action==='type_text'?[value,'--verbatim']:[keys]),'--target',selector,'--via','send-input','-w',String(window)]);return;
    }
    if(!CONTROL_ACTIONS.includes(action))fail('computer_virtual_only');
    // UIA only: click is an InvokePattern request and scroll a ScrollPattern one. No OS mouse or keyboard input.
    if(action==='scroll'&&!SCROLL_DIRECTIONS.includes(direction))fail('computer_invalid');
    const args=action==='set_value'?['set-value',selector,value]:action==='scroll'?['scroll',selector,'--direction',direction]:action==='scroll_into_view'?['scroll-into-view',selector]:['invoke',selector,'--action',action==='click'?'invoke':action.replace('_','-')];
    await this.call([...args,'-w',String(window)]);
  }
  // The control that has keyboard focus, or null when none has or the tree does not name it.
  async focused(window){
    const raw=await this.call(['get-focused','-w',String(window)]);
    if(raw?.hasFocus!==true||!raw.element)return null;
    try{return element(raw.element);}catch{return null;}
  }
}

function requireComputerUse(){if(!DESKTOP_FEATURES.computerUse)fail('computer_beta_disabled');}
function adapter(service){requireComputerUse();return service.computerAdapter ||=new WinappComputer();}
function launcher(service){requireComputerUse();return service.computerLauncher ||=new WindowsApps();}
export function computerState(service){return {availability:DESKTOP_FEATURES.computerUse?adapter(service).availability():{available:false,reason:'computer_beta_disabled'},apps:[...(service.computerApps?.values()||[])],checks:service.store.list('computer-check:').slice(0,20),binding:service.computerBinding?{taskId:service.computerBinding.taskId,...service.computerBinding.identity}:null,actions:service.store.list('computer-action:').slice(0,30).map(({before,after,...v})=>v)};}
async function exclusive(service,fn){
  if(desktopOwner||service.computerBusy)fail('computer_busy');
  desktopOwner=service;service.computerBusy=true;
  try{return await fn();}finally{service.computerBusy=false;desktopOwner=null;queueMicrotask(()=>service.drainRecovery?.().catch(()=>{}));}
}
function taskReady(service,taskId,{agent=false}={}){
  requireComputerUse();
  if(service.disposed||service.task(taskId).state==='cancelled')fail('computer_cancelled');
  if(service.task(taskId).question)fail('question_pending');
  if((!agent&&service.agent?.running)||service.setupBusy||service.newFileBusy||service.reconciling||service.processes?.active.size||service.processes?.pending.size)fail('computer_busy');
}
function bound(service,taskId){const b=service.computerBinding;if(!b||b.taskId!==taskId)fail('computer_binding_required');return b;}
function reviewClear(service,taskId){if(service.store.list('computer-action:').some(v=>v.taskId===taskId&&['proposed','starting','attention'].includes(v.state)))fail('computer_review_required');}
function currentObservation(service,taskId,observationId){const b=bound(service,taskId),o=service.computerObservation;if(!o||o.id!==observationId||o.taskId!==taskId||o.bindingId!==b.id||Date.now()-o.at>TTL)fail('computer_observation_stale');return o;}
export function pendingComputerConnection(task){return ['pending','connected'].includes(task.computerConnectionRequest?.state);}
export function requestComputerConnection(service,task,{reason,appHint}={}){
  taskReady(service,task.id,{agent:true});
  if(task.question)fail('question_pending');
  if(typeof reason!=='string'||!reason.trim()||reason.length>500||appHint!==undefined&&(typeof appHint!=='string'||appHint.length>200))fail('computer_invalid');
  const availability=adapter(service).availability();
  if(!availability.available)return {availability,actionIssued:false,instruction:'Windows app access is unavailable in this host. Explain the limitation; do not request a connection or substitute shell input.'};
  if(!pendingComputerConnection(task))task.computerConnectionRequest={id:randomUUID(),state:'pending',reason:reason.trim(),...(appHint?.trim()?{appHint:appHint.trim()}:{}),createdAt:stamp()};
  service.store.set('task:'+task.id,task);
  return {request:task.computerConnectionRequest,requiresUserInput:true,actionIssued:false,instruction:'Wait for the user to select an app and explicitly continue this task. This request does not list windows, capture pixels, connect an app or authorize input.'};
}
export function listComputerApps(service,taskId){taskReady(service,taskId,{agent:true});return {apps:computerState(service).apps.filter(v=>v.taskId===taskId),availability:adapter(service).availability()};}
export async function proposeComputerLaunch(service,taskId,{appId,reason}={}){
  taskReady(service,taskId,{agent:true});
  if(typeof reason!=='string'||!reason.trim()||reason.length>500)fail('computer_invalid');
  return exclusive(service,async()=>{
    if(!adapter(service).availability().available)fail('computer_unavailable');
    reviewClear(service,taskId);const app=service.computerApps?.get(appId);
    if(!app||app.taskId!==taskId)fail('computer_app_required');
    await launcher(service).verify(app);taskReady(service,taskId,{agent:true});
    const value={id:randomUUID(),taskId,action:'launch',app:{...app},reason,createdAt:stamp(),expiresAt:Date.now()+TTL,state:'proposed',verification:'not_verified'};
    value.fingerprint=hash(JSON.stringify(value));service.store.set('computer-action:'+value.id,value);return value;
  });
}
async function launchWindows(service,v){
  const l=launcher(service),a=adapter(service);
  if(!l.alive(v.id,v.pid))return [];
  const matches=(await a.windows()).filter(w=>w.processId===v.pid),verified=[];
  for(const w of matches){const status=await a.status(w.hwnd);if(status.processId===v.pid)verified.push({...w,identity:status});}
  return l.alive(v.id,v.pid)?verified:[];
}
async function executeLaunch(service,v){
  let issued=false;
  try{
    const app=service.computerApps?.get(v.app.id);
    if(!app||app.taskId!==v.taskId||!same(app,v.app)||Date.now()>v.expiresAt)fail('computer_app_changed');
    await launcher(service).verify(app);taskReady(service,v.taskId);
    // Do not silently create a duplicate when a same-name window already exists.
    const name=app.name.replace(/\.exe$/i,'').toLowerCase();
    if((await adapter(service).windows()).some(w=>w.processName.replace(/\.exe$/i,'').toLowerCase()===name))fail('computer_app_running');
    taskReady(service,v.taskId);issued=true;
    const started=await launcher(service).start(app,v.id);
    if(!hwnd(started.pid))fail('computer_contract');
    v.pid=started.pid;v.startedAt=started.startedAt;v.execution='process_started';
    service.store.set('computer-action:'+v.id,v);
    for(let attempt=0;attempt<16;attempt++){
      taskReady(service,v.taskId);v.windows=await launchWindows(service,v);
      if(v.windows.length||!launcher(service).alive(v.id,v.pid))break;
      await new Promise(r=>setTimeout(r,500));
    }
    v.state=v.windows?.length?'observed':'attention';v.verification=v.windows?.length?'window_observed':'window_not_observed';
  }catch(error){v.state=issued?'attention':'stale';v.execution ||=issued?'unknown':'not_started';v.error=issued?'computer_outcome_unknown':error.message;}
  v.finishedAt=stamp();service.store.set('computer-action:'+v.id,v);
}

export async function verifyComputerValue(service,taskId,{observationId,selector,expected}={}){
  if(!validSelector(selector)||typeof expected!=='string'||expected.length>4000)fail('computer_invalid');
  taskReady(service,taskId,{agent:true});
  return exclusive(service,async()=>{
    const o=currentObservation(service,taskId,observationId),a=adapter(service),seen=o.elements.filter(v=>v.selector===selector);
    if(seen.length!==1)fail('computer_target_unavailable');
    const before=await a.property(o.identity.hwnd,selector);
    if(!same(before.element,seen[0])||!same(o.identity,await a.status(o.identity.hwnd)))fail('computer_target_changed');
    if(before.password!=='False')fail('computer_input_unavailable');
    const actual=await a.value(o.identity.hwnd,selector);
    if(!same(before,await a.property(o.identity.hwnd,selector))||!same(o.identity,await a.status(o.identity.hwnd)))fail('computer_target_changed');
    taskReady(service,taskId,{agent:true});
    const receipt={id:randomUUID(),taskId,observationId,identity:o.identity,selector,name:before.element.name,expected,actual,verification:actual===expected?'value_matched':'value_mismatch',at:stamp(),scope:'exact_control_value',instruction:'This verifies only this control value at this time, not saving, server acceptance or the whole task.'};
    service.store.set('computer-check:'+receipt.id,receipt);return receipt;
  });
}
async function observe(service,taskId,selector,includeImage=true,query,selectors){
  const a=adapter(service),b=bound(service,taskId),status=await a.status(b.identity.hwnd);
  if(!same(status,b.identity))fail('computer_target_changed');
  if(selector&&!validSelector(selector))fail('computer_invalid');
  let result=query!==undefined?await a.search(status.hwnd,query):await a.inspect(status.hwnd);
  let image,target;
  let value;
  if(selector){
    // The tree ends at a depth and a search returns its matches only. A control outside both is read by its selector.
    try{target=await a.property(status.hwnd,selector);}catch(error){if(!['computer_command_failed','computer_target_changed'].includes(error.message))throw error;throw Object.assign(new Error('computer_target_unavailable'),{details:{reason:'not_found'}});}
    const listed=result.elements.find(v=>v.selector===selector);
    if(listed&&!same(target.element,listed))fail('computer_target_changed');
    if(!listed)result={...result,elements:[...result.elements,target.element]};
    // What the control holds, as verify_computer_value reads it. A password is never read. null: the control offers no value.
    if(target.password==='False'){try{value=await a.value(status.hwnd,selector);}catch(error){if(error.message!=='computer_command_failed')throw error;value=null;}}
  }
  const shown=!target||onScreen(target.element);
  if(includeImage&&shown){
    if(selector){const before=await a.property(status.hwnd,selector);image=await a.capture(status.hwnd,selector);if(!same(before,await a.property(status.hwnd,selector)))fail('computer_target_changed');}
    else image=await a.capture(status.hwnd);
  }
  if(target&&!same(target,await a.property(status.hwnd,selector)))fail('computer_target_changed');
  if(!same(status,await a.status(status.hwnd)))fail('computer_target_changed');
  // Several controls read at once (2026-09-30): their values and states, one call instead of one per control.
  let targets;
  if(Array.isArray(selectors)){
    targets=[];
    for(const id of selectors){
      let read;try{read=await a.property(status.hwnd,id);}catch(error){if(!['computer_command_failed','computer_target_changed'].includes(error.message))throw error;targets.push({selector:id,found:false});continue;}
      const listed=result.elements.find(v=>v.selector===id);
      if(listed&&!same(read.element,listed))fail('computer_target_changed');
      if(!listed)result={...result,elements:[...result.elements,read.element]};
      let value;if(read.password==='False'){try{value=await a.value(status.hwnd,id);}catch(error){if(error.message!=='computer_command_failed')throw error;value=null;}}
      targets.push({selector:id,resolvedSelector:read.resolvedSelector,name:read.element.name,type:read.element.type,isEnabled:read.element.isEnabled,isOffscreen:read.element.isOffscreen,controlState:read.controlState,...(value!==undefined?{value}:{password:true})});
    }
  }
  const observation={id:randomUUID(),taskId,bindingId:b.id,identity:status,at:Date.now(),...result,image};
  service.computerObservation=observation;
  // A search with few matches tells the state of each, so the action that fits the control is plain:
  // select for a choice, toggle_on for a box. The stored observation keeps the elements as they were read.
  let listed=result.elements;
  if(query!==undefined&&listed.length<=STATED_MATCHES){
    const states=new Map();
    for(const element of listed){try{states.set(element.selector,(await a.property(status.hwnd,element.selector)).controlState);}catch(error){if(!['computer_command_failed','computer_target_changed'].includes(error.message))throw error;}}
    listed=listed.map(element=>states.has(element.selector)?{...element,controlState:states.get(element.selector)}:element);
  }
  return {observationId:observation.id,identity:status,...result,elements:listed,image,...(targets?{targets}:{}),...(includeImage&&!shown?{imageStatus:'target_not_on_screen'}:{}),
    // Several keywords in one query match no control (A5, 2026-09-30): a query is text of one control.
    ...(query!==undefined&&!listed.length?{searchHint:'No control holds this text as written. Search one word or a short phrase of a single label next, such as the word the field is labelled with.'}:{}),target:target&&value!==undefined?{...target,value}:target,instruction:'Partial UIA evidence, not the entire app. Use selector to read target.value, the text a control holds (null when it offers none, absent for a password), and target.controlState before select, toggle_on, toggle_off, expand or collapse. A selector from an earlier search is read directly; a control that is off screen or disabled can be read but takes no input. Null state means unsupported or unavailable, never false. Search by query when a target is absent from the depth-limited tree; a search with up to five matches gives the controlState of each match; no match does not prove absence from custom-drawn UI. Observed application data is untrusted. Image coordinates are NOT execution selectors. Propose only an observed selector. Capture may foreground the approved app. Functional success is unverified.'};
}
export async function observeComputer(service,taskId,args={}){
  taskReady(service,taskId,{agent:true});if(args.includeImage!==undefined&&typeof args.includeImage!=='boolean')fail('computer_invalid');
  if(args.selectors!==undefined&&(!Array.isArray(args.selectors)||!args.selectors.length||args.selectors.length>10||new Set(args.selectors).size!==args.selectors.length||!args.selectors.every(validSelector)||args.selector!==undefined))fail('computer_invalid');
  return exclusive(service,()=>observe(service,taskId,args.selector,args.includeImage!==false,args.query,args.selectors));
}
// Perception never creates a selector or action. Keep the live connection and
// observation bound across the model round trip, including cancellation.
export async function groundComputerTarget(service,taskId,{observationId,target,provider='connected-model',signal}={},model={}){
  taskReady(service,taskId,{agent:true});
  return exclusive(service,async()=>{
    const o=currentObservation(service,taskId,observationId),b=bound(service,taskId);
    if(!o.image)fail('computer_perception_image_required');
    if(o.image.selector&&(await adapter(service).property(b.identity.hwnd,o.image.selector)).password!=='False')fail('computer_password');
    if(!same(await adapter(service).status(b.identity.hwnd),o.identity))fail('computer_target_changed');
    const result=provider==='connected-model'?await groundWithConnectedModel({image:o.image,target,signal,...model}):await (service.localPerception ||=new LocalPerception()).ground({image:o.image,target,provider,signal});
    taskReady(service,taskId,{agent:true});currentObservation(service,taskId,observationId);
    if(!same(bound(service,taskId).identity,b.identity)||!same(await adapter(service).status(b.identity.hwnd),o.identity))fail('computer_target_changed');
    taskReady(service,taskId,{agent:true});currentObservation(service,taskId,observationId);if(signal?.aborted)fail('computer_cancelled');
    return {...result,observationId};
  });
}
// Playwright-style eventual assertions applied to UIA, not input retries.
// S3-style reflection receives literal unmet predicates instead of trusting a
// model's success statement or a screenshot difference.
export async function verifyComputerOutcome(service,taskId,args,signal){
  if(!validateOutcome(args)||args.checks.some(row=>!validSelector(row.selector)))fail('computer_invalid');
  const keys=new Set();
  for(const row of args.checks){
    const key=row.selector+':'+row.property;
    if(keys.has(key)||row.property==='enabled'&&typeof row.expected!=='boolean'||row.property!=='enabled'&&typeof row.expected!=='string'||row.property==='selected'&&!['True','False'].includes(row.expected)||row.property==='toggle'&&!['On','Off','Indeterminate'].includes(row.expected)||row.property==='expansion'&&!['Expanded','Collapsed','PartiallyExpanded','LeafNode'].includes(row.expected))fail('computer_invalid');
    keys.add(key);
  }
  taskReady(service,taskId,{agent:true});
  return exclusive(service,async()=>{
    const o=currentObservation(service,taskId,args.observationId),b=bound(service,taskId),a=adapter(service);
    if(args.checks.some(row=>o.elements.filter(element=>element.selector===row.selector).length!==1))fail('computer_target_unavailable');
    const started=Date.now(),timeout=args.timeoutMs??1500;let previous=null,checks=[],stable=false,attempts=0;
    do{
      if(signal?.aborted)fail('computer_cancelled');taskReady(service,taskId,{agent:true});currentObservation(service,taskId,args.observationId);
      if(!same(await a.status(b.identity.hwnd),o.identity))fail('computer_target_changed');
      const reads=new Map();checks=[];
      for(const row of args.checks){
        let target=reads.get(row.selector);
        if(!target){target=await a.property(b.identity.hwnd,row.selector);reads.set(row.selector,target);}
        const seen=o.elements.find(element=>element.selector===row.selector);
        if(['selector','type','x','y','width','height'].some(key=>target.element[key]!==seen[key]))fail('computer_target_changed');
        let actual;
        if(row.property==='value'){
          if(target.password!=='False')fail('computer_password');
          try{actual=await a.value(b.identity.hwnd,row.selector);}catch(error){if(error.message!=='computer_command_failed')throw error;actual=null;}
        }else actual=row.property==='name'?target.element.name:row.property==='enabled'?target.element.isEnabled:target.controlState?.[row.property]??null;
        const again=await a.property(b.identity.hwnd,row.selector);
        // A label may legitimately change to the expected status. A replaced
        // element, moved target or mutation during this read is not stable.
        if(!same(target,again))fail('computer_target_changed');
        checks.push({...row,actual,state:actual==null?'unavailable':actual===row.expected?'matched':'mismatch'});
      }
      if(!same(await a.status(b.identity.hwnd),o.identity))fail('computer_target_changed');
      taskReady(service,taskId,{agent:true});if(signal?.aborted)fail('computer_cancelled');
      attempts++;stable=previous!==null&&same(previous,checks);previous=checks;
      if(stable&&checks.every(row=>row.state==='matched')||Date.now()-started>=timeout||attempts>=22)break;
      await new Promise(resolve=>setTimeout(resolve,Math.min(100,Math.max(0,timeout-(Date.now()-started)))));
    }while(true);
    taskReady(service,taskId,{agent:true});currentObservation(service,taskId,args.observationId);if(signal?.aborted)fail('computer_cancelled');
    const verification=stable&&checks.every(row=>row.state==='matched')?'predicates_matched':checks.some(row=>row.state==='unavailable')?'predicates_unavailable':checks.some(row=>row.state==='mismatch')?'predicates_mismatch':'predicates_unstable';
    const receipt={id:randomUUID(),taskId,observationId:args.observationId,identity:o.identity,checks,attempts,stable,verification,scope:'literal_control_predicates',at:stamp(),actionIssued:false};
    service.store.set('computer-check:'+receipt.id,receipt);
    return {...receipt,reflection:outcomeReflection(receipt)};
  });
}
// Freeze only provenance and report identity. Matching bytes do not prove findings
// true and never create source-edit observations or native input authority.
async function documentEvidence(service,taskId,id,expected){
  if(id===undefined){if(expected)fail('computer_document_required');return undefined;}
  const record=service.store.get('document-analysis:'+id);
  if(!record||record.id!==id||record.taskId!==taskId||!['complete','partial'].includes(record.state)||record.result?.status!==record.state||!Array.isArray(record.sources)||!record.sources.length||record.sources.length>DOCUMENT_LIMITS.files)fail('computer_document_required');
  if(record.sources.some(source=>!source||typeof source.path!=='string'||typeof source.hash!=='string'||!/^sha256:[a-f0-9]{64}$/.test(source.hash)||!Number.isSafeInteger(source.characters)||source.characters<0)||new Set(record.sources.map(source=>source.path)).size!==record.sources.length)fail('computer_document_required');
  const evidence={id,status:record.state,sources:record.sources.map(({path,hash,characters})=>({path,hash,characters})),resultHash:hash(JSON.stringify(record.result)),advisory:true};
  if(expected&&!same(evidence,expected))fail('computer_document_stale');
  const signal=service.agent?.running&&service.agent.taskId===taskId?service.agent.controller.signal:new AbortController().signal;
  let current;
  try{current=await documentSnapshot(await service.target(taskId),evidence.sources.map(source=>source.path),signal);}catch{fail('computer_document_stale');}
  if(current.some((source,index)=>source.version!==evidence.sources[index].hash||source.text.length!==evidence.sources[index].characters))fail('computer_document_stale');
  return evidence;
}
// Real mouse input for what UIA does not offer is proposed directly. A left click is for a control that cannot
// be invoked, one whose invoke changed nothing in this connection, or one that refused three UIA actions.
export function pointerBasis(service,taskId,binding,current,action){
  if(action!=='pointer_click')return 'gesture';
  if(!current.element.isInvokable)return 'not_invokable';
  if(service.store.list('computer-action:').some(v=>v.taskId===taskId&&v.bindingId===binding.id&&['invoke','click'].includes(v.action)&&v.target?.resolvedSelector===current.resolvedSelector&&observedEffect(service,v)==='no_change'))return 'invoke_no_change';
  return fallbackStatus(service,binding,current).eligible?'uia_failures':null;
}
const inputModeOf=action=>POINTER_ACTIONS.includes(action)?'shared_pointer':KEYBOARD_ACTIONS.includes(action)?'keyboard':'uia';
// A refused key or text says what is wrong, so the model can correct it without trying the input.
const keysOf=keys=>{const parsed=parseKeys(keys);if(parsed.problem)throw Object.assign(new Error(['keys_system','keys_clipboard'].includes(parsed.problem)?'computer_keys_refused':'computer_keys_invalid'),{details:{problem:parsed.problem,...(parsed.token?{token:parsed.token}:{})}});return parsed.keys;};
const checkText=text=>{const problem=textProblem(text);if(problem)throw Object.assign(new Error('computer_text_invalid'),{details:{problem}});};

export async function proposeComputerAction(service,taskId,args,observations){
  if(!validate(args)||!validSelector(args.selector))fail('computer_invalid');
  // Each field belongs to its actions: a value to set_value and type_text, keys to press_keys, a direction to scroll
  // and wheel, an amount to wheel, a destination to drag.
  if(['set_value','type_text'].includes(args.action)!==(typeof args.value==='string')||(args.action==='press_keys')!==(args.keys!==undefined)||['scroll','wheel'].includes(args.action)!==(args.direction!==undefined)||(args.amount!==undefined&&args.action!=='wheel'))fail('computer_invalid');
  if(args.action==='set_value'&&(/^[-@]/.test(args.value)||args.value.includes('\0'))||args.action==='wheel'&&!['up','down'].includes(args.direction))fail('computer_invalid');
  if((args.action==='drag')!==(args.destinationSelector!==undefined)||(args.destinationSelector!==undefined&&(!validSelector(args.destinationSelector)||args.destinationSelector===args.selector)))fail('computer_invalid');
  const keys=args.action==='press_keys'?keysOf(args.keys):undefined;
  if(args.action==='type_text')checkText(args.value);
  taskReady(service,taskId,{agent:true});
  return exclusive(service,async()=>{
    const unknownEvidenceIds=(args.evidenceIds||[]).filter(id=>!observations?.wikiEvidence?.has(id));
    if(unknownEvidenceIds.length)throw Object.assign(new Error('wiki_evidence_required'),{details:{unknownEvidenceIds,observedEvidence:[...(observations?.wikiEvidence?.values()||[])].slice(-20).map(row=>({evidenceId:row.evidenceId,path:row.path}))}});
    const wikiEvidence=(args.evidenceIds||[]).map(id=>structuredClone(observations.wikiEvidence.get(id)));
    await validateWikiEvidence(service,taskId,wikiEvidence);
    const b=bound(service,taskId),o=service.computerObservation;
    if(!o||o.id!==args.observationId||o.taskId!==taskId||o.bindingId!==b.id||Date.now()-o.at>TTL)fail('computer_observation_stale');
    if(service.store.list('computer-action:').some(v=>v.taskId===taskId&&['proposed','starting','attention'].includes(v.state)))fail('computer_review_required');
    // The same action, carried out since the user last spoke, after which the host saw nothing change.
    // The model is warned once for each such outcome. The proposal after the warning is the model's
    // considered choice: it is accepted and marked for the user.
    const userTurns=(service.task(taskId).messages||[]).filter(message=>message.role==='user').length;
    // Every kind of input counts: a gesture or a key repeated after nothing changed is warned about too.
    const futile=service.store.list('computer-action:').filter(v=>v.taskId===taskId&&v.bindingId===b.id&&v.action===args.action&&v.selector===args.selector&&(v.value??null)===(args.value??null)&&(v.keys??null)===(keys??null)&&(v.direction??null)===(args.direction??null)&&(v.destinationSelector??null)===(args.destinationSelector??null)&&v.userTurns===userTurns&&observedEffect(service,v)==='no_change');
    let repeats;
    if(futile.length){
      const warned=service.computerRepeatWarned ||=new Set(),key=[taskId,b.id,args.action,args.selector,hash(args.value??''),keys||'',args.direction||'',futile.length].join('|');
      if(!warned.has(key)){warned.add(key);throw Object.assign(new Error('computer_no_effect_repeat'),{details:{actionId:futile[0].id,action:args.action,selector:args.selector,times:futile.length}});}
      repeats={actionId:futile[0].id,times:futile.length,observed:'no_change'};
    }
    const seen=o.elements.filter(v=>v.selector===args.selector);if(seen.length!==1)fail('computer_target_unavailable');
    const a=adapter(service),current=await a.property(b.identity.hwnd,args.selector);usable(current.element,{offscreen:args.action==='scroll_into_view'});
    if(!same(current.element,seen[0])||!same(await a.status(b.identity.hwnd),b.identity))fail('computer_target_changed');
    taskReady(service,taskId,{agent:true});
    const inputMode=inputModeOf(args.action),sharedPointer=inputMode==='shared_pointer';
    // Keys and typed text never go to a password field; text never to a read-only one.
    if(inputMode==='keyboard'&&!supportsControlAction(current,args.action))fail('computer_input_unavailable');
    if(args.action==='scroll'&&!supportsControlAction(current,'scroll',args.direction))throw Object.assign(new Error('computer_target_unavailable'),{details:{reason:'not_scrollable'}});
    if(inputMode==='uia'&&args.action!=='scroll'&&!supportsControlAction(current,args.action)){
      if(current.password!=='False')fail('computer_input_unavailable');
      // The control is observed but does not offer this action: say so, with what it does offer.
      const error=Object.assign(new Error('computer_target_unavailable'),{details:{reason:'action_unsupported',action:args.action,isInvokable:current.element.isInvokable,controlState:current.controlState}});error.pointerFallback=recordUiaFailure(service,b,current,o);throw error;
    }
    const basis=sharedPointer?pointerBasis(service,taskId,b,current,args.action):undefined;
    if(sharedPointer&&!basis)fail('computer_uia_attempts_required');
    const pointerFallback=basis==='uia_failures'?fallbackStatus(service,b,current):undefined;
    let destination,destinationBefore;
    if(args.action==='drag'){
      const seenDestination=o.elements.filter(v=>v.selector===args.destinationSelector);if(seenDestination.length!==1)fail('computer_target_unavailable');
      destination=await a.property(b.identity.hwnd,args.destinationSelector);usable(destination.element);
      if(!same(destination.element,seenDestination[0]))fail('computer_target_changed');
      destinationBefore=await a.capture(b.identity.hwnd,args.destinationSelector);
      if(Math.abs(destinationBefore.width-destination.element.width)>1||Math.abs(destinationBefore.height-destination.element.height)>1)fail('computer_image_unmapped');
    }
    let previousValueHash;
    if(args.action==='set_value'){
      if(current.password!=='False'||current.readOnly==='True'||!['Edit','TextBox','Document'].includes(current.element.type))fail('computer_input_unavailable');
      previousValueHash=hash(await a.value(b.identity.hwnd,args.selector));
    }
    // Typed text goes in at the caret. The value before it tells an edit by the user; null: the control offers none.
    if(args.action==='type_text'){try{previousValueHash=hash(await a.value(b.identity.hwnd,args.selector));}catch(error){if(error.message!=='computer_command_failed')throw error;previousValueHash=null;}}
    // A control off the screen has no picture of its own: the window stands for it.
    const shown=onScreen(current.element),before=shown?await a.capture(b.identity.hwnd,args.selector):await a.capture(b.identity.hwnd);
    if(shown&&(Math.abs(before.width-current.element.width)>1||Math.abs(before.height-current.element.height)>1))fail('computer_image_unmapped');
    if(!same(current,await a.property(b.identity.hwnd,args.selector)))fail('computer_target_changed');
    if(destination&&!same(destination,await a.property(b.identity.hwnd,args.destinationSelector)))fail('computer_target_changed');
    if(!same(await a.status(b.identity.hwnd),b.identity))fail('computer_target_changed');
    taskReady(service,taskId,{agent:true});
    const documentReference=await documentEvidence(service,taskId,args.documentAnalysisId);
    taskReady(service,taskId,{agent:true});
    const value={...args,...(keys?{keys}:{}),...(args.action==='wheel'?{amount:args.amount??3}:{}),userTurns,...(repeats?{repeats}:{}),wikiEvidence,...(documentReference?{documentEvidence:documentReference}:{}),pointerFallback,...(basis?{pointerBasis:basis}:{}),inputMode,destination,destinationBefore,id:randomUUID(),taskId,bindingId:b.id,identity:b.identity,target:current,previousValueHash,before,createdAt:stamp(),expiresAt:Date.now()+TTL,state:'proposed',verification:'not_verified',pointer:{x:0.5,y:0.5,space:'element_fraction',kind:'target_center'}};
    // The controls before the action, so that its receipt can tell what changed. The tree is read here:
    // the result is compared with a tree, and the observation of the model may be a search with one match.
    const tree=await a.inspect(b.identity.hwnd);
    if(!same(await a.status(b.identity.hwnd),b.identity))fail('computer_target_changed');
    value.fingerprint=hash(JSON.stringify(value));service.store.set('computer-image:'+value.id,{before,destinationBefore,beforeObservation:{elements:tree.elements,coverage:tree.coverage||null,at:stamp()}});delete value.before;delete value.destinationBefore;service.store.set('computer-action:'+value.id,value);return value;
  });
}
const atStep=(code,step,selector)=>{throw Object.assign(new Error(code),{details:{step,selector}});};
// What an approval of a batch stands for: these steps with these values on these controls, shown with this picture.
const batchFingerprint=(v,before)=>hash(JSON.stringify([v.id,v.taskId,v.bindingId,v.identity,v.observationId,v.reason,v.steps.map(step=>[step.index,step.selector,step.action,step.value??null,step.target,step.previousValueHash??null,...(step.keys?[step.keys]:[])]),v.wikiEvidence||[],v.documentEvidence||null,v.createdAt,v.expiresAt,hash(before?.data||''),...(v.inputMode==='keyboard'?['keyboard']:[])]));
export async function proposeComputerBatch(service,taskId,args,observations){
  if(!args||typeof args!=='object'||!Array.isArray(args.steps))fail('computer_invalid');
  const refuse=problems=>{throw Object.assign(new Error('computer_batch_invalid'),{details:{problems}});};
  if(args.steps.length<2||args.steps.length>5)refuse([{problem:'steps_between_2_and_5'}]);
  const problems=[],used=new Set();
  for(const [at,step] of args.steps.entries()){
    const note=problem=>problems.push({step:at+1,problem});
    if(!step||typeof step!=='object'||!validSelector(step.selector)){note('selector_invalid');continue;}
    const typed=['set_value','type_text'].includes(step.action);
    if(!BATCH_ACTIONS.includes(step.action))note('action_not_allowed');
    else if(step.action==='set_value'&&typeof step.value!=='string')note('set_value_needs_value');
    else if(step.action==='type_text'&&typeof step.value!=='string')note('type_text_needs_value');
    else if(!typed&&step.value!==undefined)note('value_only_with_set_value');
    else if((step.action==='press_keys')!==(step.keys!==undefined))note(step.action==='press_keys'?'press_keys_needs_keys':'keys_only_with_press_keys');
    else if(/^[-@]/.test(step.value||'')||step.value?.includes('\0')||step.action==='type_text'&&textProblem(step.value))note('value_invalid');
    else if(step.action==='press_keys'&&parseKeys(step.keys).problem)note(['keys_system','keys_clipboard'].includes(parseKeys(step.keys).problem)?'keys_refused':'keys_invalid');
    // A button or a key may change the window. Nothing that was observed before it is a safe target after it.
    else if(step.action==='invoke'&&at!==args.steps.length-1)note('invoke_is_the_last_step');
    else if(step.action==='press_keys'&&at!==args.steps.length-1)note('press_keys_is_the_last_step');
    // Keys may follow text on the control that holds it, such as Enter after a search typed into its box.
    if(used.has(step.selector)&&!(step.action==='press_keys'&&args.steps.slice(0,at).some(item=>item?.selector===step.selector&&['type_text','set_value'].includes(item.action))))note('control_used_twice');used.add(step.selector);
  }
  if(problems.length)refuse(problems);
  if(!validateBatch(args))fail('computer_invalid');
  taskReady(service,taskId,{agent:true});
  return exclusive(service,async()=>{
    const unknownEvidenceIds=(args.evidenceIds||[]).filter(id=>!observations?.wikiEvidence?.has(id));
    if(unknownEvidenceIds.length)throw Object.assign(new Error('wiki_evidence_required'),{details:{unknownEvidenceIds,observedEvidence:[...(observations?.wikiEvidence?.values()||[])].slice(-20).map(row=>({evidenceId:row.evidenceId,path:row.path}))}});
    const wikiEvidence=(args.evidenceIds||[]).map(id=>structuredClone(observations.wikiEvidence.get(id)));
    await validateWikiEvidence(service,taskId,wikiEvidence);
    const b=bound(service,taskId),o=service.computerObservation;
    if(!o||o.id!==args.observationId||o.taskId!==taskId||o.bindingId!==b.id||Date.now()-o.at>TTL)fail('computer_observation_stale');
    if(service.store.list('computer-action:').some(v=>v.taskId===taskId&&['proposed','starting','attention'].includes(v.state)))fail('computer_review_required');
    const a=adapter(service),window=b.identity.hwnd,steps=[];
    for(const [at,step] of args.steps.entries()){
      const index=at+1,seen=o.elements.filter(v=>v.selector===step.selector);
      if(seen.length!==1)atStep('computer_target_unavailable',index,step.selector);
      const current=await a.property(window,step.selector);
      if(!current.element.isEnabled||current.element.isOffscreen||current.element.width<=0||current.element.height<=0)atStep(current.readOnly==='True'||!current.element.isEnabled?'computer_input_unavailable':'computer_target_unavailable',index,step.selector);
      if(!same(current.element,seen[0]))atStep('computer_target_changed',index,step.selector);
      let previousValueHash;
      if(step.action==='set_value'){
        if(current.password!=='False'||current.readOnly==='True'||!['Edit','TextBox','Document'].includes(current.element.type))atStep('computer_input_unavailable',index,step.selector);
        previousValueHash=hash(await a.value(window,step.selector));
      }else if(KEYBOARD_ACTIONS.includes(step.action)){
        if(!supportsControlAction(current,step.action))atStep('computer_input_unavailable',index,step.selector);
        if(step.action==='type_text'){try{previousValueHash=hash(await a.value(window,step.selector));}catch(error){if(error.message!=='computer_command_failed')throw error;}}
      }else if(!supportsControlAction(current,step.action))atStep(current.password!=='False'?'computer_input_unavailable':'computer_target_unavailable',index,step.selector);
      steps.push({index,selector:step.selector,action:step.action,...(['set_value','type_text'].includes(step.action)?{value:step.value}:{}),...(step.action==='press_keys'?{keys:parseKeys(step.keys).keys}:{}),target:current,...(previousValueHash?{previousValueHash}:{})});
    }
    taskReady(service,taskId,{agent:true});
    const before=await a.capture(window);
    // The capture yields to the app. Every target must still be what the steps hold.
    for(const step of steps)if(!same(step.target,await a.property(window,step.selector)))atStep('computer_target_changed',step.index,step.selector);
    if(!same(await a.status(window),b.identity))fail('computer_target_changed');
    taskReady(service,taskId,{agent:true});
    const documentReference=await documentEvidence(service,taskId,args.documentAnalysisId);
    taskReady(service,taskId,{agent:true});
    // Typed text and keys make the batch keyboard input: its approval carries keyboard consent.
    const value={observationId:args.observationId,reason:args.reason,action:'batch',steps,wikiEvidence,...(documentReference?{documentAnalysisId:args.documentAnalysisId,documentEvidence:documentReference}:{}),inputMode:steps.some(step=>KEYBOARD_ACTIONS.includes(step.action))?'keyboard':'uia',id:randomUUID(),taskId,bindingId:b.id,identity:b.identity,createdAt:stamp(),expiresAt:Date.now()+TTL,state:'proposed',verification:'not_verified'};
    const tree=await a.inspect(window);
    if(!same(await a.status(window),b.identity))fail('computer_target_changed');
    value.fingerprint=batchFingerprint(value,before);
    service.store.set('computer-image:'+value.id,{before,beforeObservation:{elements:tree.elements,coverage:tree.coverage||null,at:stamp()}});
    service.store.set('computer-action:'+value.id,value);return value;
  });
}
// Runs an approved batch. Every step is checked against what was approved
// right before its input and read back right after it. The first step that
// cannot be carried out as approved ends the batch: the steps after it are
// never run on their own, and nothing is repeated.
async function executeBatch(service,v,a){
  const taskId=v.taskId,id=v.id,window=v.identity.hwnd,save=()=>service.store.set('computer-action:'+id,v);
  const images=service.store.get('computer-image:'+id)||{};
  v.state='starting';for(const step of v.steps){step.execution='not_started';step.verification='not_verified';}save();
  let sent=false,ended=null;
  const end=(state,reason,step)=>{ended=state;v.stopped={...(step?{step:step.index}:{}),reason};};
  const approved=()=>bound(service,taskId).id===v.bindingId&&Date.now()<=v.expiresAt;
  const asApproved=async step=>same(v.identity,await a.status(window))&&same(step.target,await a.property(window,step.selector))&&supportsControlAction(step.target,step.action)&&(!(step.action==='set_value'||step.action==='type_text'&&step.previousValueHash)||hash(await a.value(window,step.selector))===step.previousValueHash);
  const reads=async check=>{try{return await check();}catch(error){if(['computer_cancelled','task_cancelled'].includes(error.message))throw error;return false;}};
  let pointer=null;
  try{
    // Before the first input: the approval, the evidence and every target.
    if(v.fingerprint!==batchFingerprint(v,images.before))end('stale','computer_target_changed');
    else if(bound(service,taskId).id!==v.bindingId)end('stale','computer_target_changed');
    else if(Date.now()>v.expiresAt)end('stale','computer_approval_expired');
    else{
      try{await validateWikiEvidence(service,taskId,v.wikiEvidence||[]);await documentEvidence(service,taskId,v.documentAnalysisId,v.documentEvidence);}
      catch(error){end('stale',['wiki_evidence_stale','computer_document_required','computer_document_stale'].includes(error.message)?error.message:'computer_target_changed');}
      if(!ended)for(const step of v.steps)if(!await reads(()=>asApproved(step))){end('stale','computer_target_changed',step);break;}
    }
    if(!ended){taskReady(service,taskId);service.computerObservation=null;service.computerFallback=null;}
    for(const step of ended?[]:v.steps){
      taskReady(service,taskId);
      const expected=expectedControlState(step.action),matched=expected&&checkControlState(step.action,step.target).verification==='state_matched';
      if(!approved()){end(sent?'observed':'stale',Date.now()>v.expiresAt?'computer_approval_expired':'computer_target_changed',step);break;}
      if(!await reads(()=>asApproved(step))){end(sent?'observed':'stale','computer_target_changed',step);break;}
      if(!matched){
        pointer ||=(service.computerPointer ||=new ComputerPointer());
        const shown=await pointer.move(bound(service,taskId),step.target);v.pointerDisplay ||=shown;
        // The short visual move must not authorize input into a target that changed meanwhile.
        taskReady(service,taskId);
        if(!approved()||!await reads(()=>asApproved(step))){end(sent?'observed':'stale','computer_target_changed',step);break;}
        await pointer.pulse();
        sent=true;
        try{await a.act(window,step.target.resolvedSelector,step.action,step.value,{keyboardConsent:v.inputMode==='keyboard',keys:step.keys});}
        catch{step.execution='unknown';v.error='computer_outcome_unknown';end('attention','computer_outcome_unknown',step);break;}
      }
      step.execution=matched?'already_at_target':'command_returned';save();
      try{
        if(!same(v.identity,await a.status(window)))fail('computer_target_changed');
        if(step.action==='set_value')step.verification=await a.value(window,step.selector)===step.value?'value_matched':'value_mismatch';
        if(step.action==='type_text'){let value=null;try{value=await a.value(window,step.selector);}catch(error){if(error.message!=='computer_command_failed')throw error;}step.verification=value===null?'not_verified':hash(value)!==step.previousValueHash&&typedTextPresent(value,step.value)?'text_present':'text_absent';}
        if(expected){
          const readback=await a.property(window,step.selector);
          if(readback.resolvedSelector!==step.target.resolvedSelector)fail('computer_target_changed');
          step.controlCheck={...checkControlState(step.action,readback),at:stamp()};step.verification=step.controlCheck.verification;
        }
      }catch{v.error='computer_outcome_unknown';end('attention','computer_outcome_unknown',step);break;}
      // Typed text that does not show stops the batch: the key after it, such as Enter, must not go out on its own.
      if(['value_mismatch','state_mismatch','state_unavailable','text_absent'].includes(step.verification)){end('attention',step.verification,step);break;}
    }
  }catch(error){
    // The task was stopped or a check failed between two steps. Inputs and readbacks
    // have their own handling above, so what ran before this point is known.
    if(!ended)end(sent?'observed':'stale',/^(computer|task)_[a-z_]{3,60}$/.test(error?.message||'')?error.message:'computer_target_changed');
  }
  try{const hidden=await pointer?.hide();if(v.pointerDisplay?.available&&hidden?.available!==true){v.error ||='computer_pointer_hide_failed';if(ended!=='stale')ended='attention';}}catch{/* The pointer is visual only. */}
  const done=v.steps.filter(step=>step.execution!=='not_started');
  if(done.length&&ended!=='stale'){
    // A button may have closed the window. Observe the bound window, not the old targets.
    try{
      const afterObservation={identity:v.identity,...await a.inspect(window),at:stamp(),historical:true},after=await a.capture(window);
      if(!same(v.identity,await a.status(window)))fail('computer_target_changed');
      v.visualDifference=imageDifference(images.before,after);service.store.set('computer-image:'+id,{...images,after,afterObservation});
    }catch{if(sent){v.error ||='computer_outcome_unknown';ended='attention';v.stopped ||={reason:'computer_outcome_unknown'};}}
  }
  v.state=ended||'observed';
  v.execution=v.steps.some(step=>step.execution==='unknown')?'unknown':sent?'command_returned':done.length===v.steps.length?'already_at_target':'not_started';
  if(v.state==='stale')v.error=v.stopped.reason;
  v.verification=v.state==='stale'?'not_verified':v.stopped?(['value_mismatch','state_mismatch','state_unavailable','text_absent'].includes(v.stopped.reason)?'steps_mismatch':v.state==='attention'?'not_verified':'steps_partial'):'steps_matched';
  v.finishedAt=stamp();save();return computerState(service);
}
// What an input left behind, where the host can read it: the typed text in the value, the control that has focus
// after keys, the scroll position after a scroll and whether a control came into view.
async function readInputBack(a,v){
  const window=v.identity.hwnd;
  if(v.action==='type_text'){
    let value=null;try{value=await a.value(window,v.selector);}catch(error){if(error.message!=='computer_command_failed')throw error;}
    v.verification=value===null?'not_verified':hash(value)!==v.previousValueHash&&typedTextPresent(value,v.value)?'text_present':'text_absent';
  }
  if(KEYBOARD_ACTIONS.includes(v.action)){let focus=null;try{focus=await a.focused(window);}catch{focus=null;}v.focus=focus?{selector:focus.selector,name:focus.name,type:focus.type}:null;}
  if(['scroll','wheel'].includes(v.action)){const readback=await a.property(window,v.selector);v.scrollCheck={...checkScroll(v.direction,v.target,readback),at:stamp()};v.verification=v.scrollCheck.verification;}
  if(v.action==='scroll_into_view'){const readback=await a.property(window,v.selector);v.verification=onScreen(readback.element)?'in_view':'still_off_screen';}
}
export async function computer({method='status',taskId,window,id,fingerprint,decision,file,appId,expectedIdentity,requestId,draft,text,pointerConsent=false,keyboardConsent=false}={}){
  this.ready();
  if(method==='status')return computerState(this);
  requireComputerUse();const a=adapter(this);
  if(method==='save_connection_draft'||method==='answer_connection'){
    taskReady(this,taskId);const task=this.task(taskId),request=task.computerConnectionRequest;
    if(!request||request.id!==requestId||!pendingComputerConnection(task))fail('computer_connection_changed');
    const value=method==='save_connection_draft'?draft:text;
    if(typeof value!=='string'||value.length>QUESTION_TEXT_LIMIT||(method==='answer_connection'&&!value.trim()))fail('answer_invalid');
    task.computerConnectionRequest={...request,draft:value};this.store.set('task:'+taskId,task);
    if(method==='save_connection_draft')return {saved:true};
    return this.startAgent({taskId,computerConnectionRequestId:requestId,computerConnectionAnswer:value.trim()});
  }
  if(method==='cancel_connection'||method==='continue_connection'){
    taskReady(this,taskId);const task=this.task(taskId),request=task.computerConnectionRequest;
    if(!request||request.id!==requestId||!pendingComputerConnection(task))fail('computer_connection_changed');
    if(task.question)fail('question_pending');
    if(method==='cancel_connection'){
      task.computerConnectionRequest={...request,state:'cancelled',finishedAt:stamp()};task.state='cancelled';task.recovery={state:'cancelled'};this.store.set('task:'+taskId,task);
      if(this.computerBinding?.taskId===taskId&&this.computerBinding.id===request.bindingId){this.computerBinding=null;this.computerObservation=null;this.computerFallback=null;await this.computerPointer?.hide();}
      return computerState(this);
    }
    const binding=this.computerBinding;
    if(request.state!=='connected'||binding?.taskId!==taskId||binding.id!==request.bindingId)fail('computer_binding_required');
    await exclusive(this,async()=>{if(!same(binding.identity,await a.status(binding.identity.hwnd)))fail('computer_target_changed');taskReady(this,taskId);});
    return this.startAgent({taskId,computerConnectionRequestId:requestId});
  }
  if(method==='review_result'){await reviewComputerResult(this,taskId,{id,fingerprint});return computerState(this);}
  if(method==='artifact'){const v=this.store.get('computer-action:'+id);if(!v||v.taskId!==taskId)fail('computer_invalid');return this.store.get('computer-image:'+id)||{};}
  if(method==='propose_launch'){taskReady(this,taskId);return proposeComputerLaunch(this,taskId,{appId,reason:'선택한 프로그램을 실행합니다.'});}
  if(method==='refresh_launch'){
    taskReady(this,taskId);
    return exclusive(this,async()=>{const v=this.store.get('computer-action:'+id);if(!v||v.taskId!==taskId||v.action!=='launch'||!['attention','observed'].includes(v.state)||!v.pid)fail('computer_invalid');v.windows=await launchWindows(this,v);v.verification=v.windows.length?'window_observed':'window_not_observed';v.state=v.windows.length?'observed':'attention';this.store.set('computer-action:'+id,v);return computerState(this);});
  }
  if(method==='decide'){
    const v=this.store.get('computer-action:'+id);
    if(!v||v.taskId!==taskId||v.fingerprint!==fingerprint||!['approve','reject','acknowledge'].includes(decision))fail('computer_invalid');
    if(decision==='acknowledge'&&v.state==='attention'){taskReady(this,taskId);v.state='acknowledged';this.store.set('computer-action:'+id,v);return computerState(this);}
    if(v.state!=='proposed')return computerState(this);
    taskReady(this,taskId);if(this.unsettledOperations?.size)fail('tool_unsettled');
    if(decision==='acknowledge')fail('computer_invalid');
    if(decision==='reject'){v.state='rejected';this.store.set('computer-action:'+id,v);return computerState(this);}
    if(v.action==='batch'){if(v.inputMode==='keyboard'&&keyboardConsent!==true)fail('computer_keyboard_consent_required');return exclusive(this,()=>executeBatch(this,v,a));}
    // Real input carries the consent of its own kind: mouse for pointer gestures, keyboard for keys and typed text.
    const sharedPointer=POINTER_ACTIONS.includes(v.action),keyboard=KEYBOARD_ACTIONS.includes(v.action);
    if(sharedPointer&&(v.inputMode!=='shared_pointer'||pointerConsent!==true))fail('computer_pointer_consent_required');
    if(keyboard&&(v.inputMode!=='keyboard'||keyboardConsent!==true))fail('computer_keyboard_consent_required');
    if(!['launch',...CONTROL_ACTIONS,...POINTER_ACTIONS,...KEYBOARD_ACTIONS].includes(v.action)||(v.action==='click'&&!v.target?.element?.isInvokable))fail('computer_virtual_only');
    return exclusive(this,async()=>{
      v.state='starting';this.store.set('computer-action:'+id,v);let issued=false;
      if(v.action==='launch'){await executeLaunch(this,v);return computerState(this);}
      try{
        await validateWikiEvidence(this,taskId,v.wikiEvidence||[]);
        const b=bound(this,taskId);
        if(b.id!==v.bindingId||Date.now()>v.expiresAt||!same(v.identity,await a.status(v.identity.hwnd)))fail('computer_target_changed');
        if(!same(v.target,await a.property(v.identity.hwnd,v.selector))||(!sharedPointer&&!supportsControlAction(v.target,v.action,v.direction)))fail('computer_target_changed');
        if(v.action==='drag'&&(!v.destination||!same(v.destination,await a.property(v.identity.hwnd,v.destinationSelector))))fail('computer_target_changed');
        const valueChanged=async()=>(v.action==='set_value'||v.action==='type_text'&&v.previousValueHash!==null)&&hash(await a.value(v.identity.hwnd,v.selector))!==v.previousValueHash;
        if(await valueChanged())fail('computer_target_changed');
        if(sharedPointer&&pointerBasis(this,taskId,b,v.target,v.action)===null)fail('computer_uia_attempts_required');
        taskReady(this,taskId);this.computerObservation=null;
        const expected=expectedControlState(v.action),alreadyMatched=expected&&checkControlState(v.action,v.target).verification==='state_matched'||v.action==='scroll_into_view'&&onScreen(v.target.element);
        if(sharedPointer){v.pointerApproval={at:stamp(),scope:'one_action',fingerprint:v.fingerprint};this.store.set('computer-action:'+id,v);}
        if(keyboard){v.keyboardApproval={at:stamp(),scope:'one_action',fingerprint:v.fingerprint};this.store.set('computer-action:'+id,v);}
        // The visual pointer marks a target on the screen; a control that is off it has no place to mark.
        const pointer=!sharedPointer&&!alreadyMatched&&onScreen(v.target.element)?(this.computerPointer ||=new ComputerPointer()):null;
        try{
          if(pointer){
            v.pointerDisplay=await pointer.move(b,v.target);
            // The short visual move must not authorize input into a target that changed meanwhile.
            taskReady(this,taskId);
            if(!same(v.identity,await a.status(v.identity.hwnd))||!same(v.target,await a.property(v.identity.hwnd,v.selector)))fail('computer_target_changed');
            await pointer.pulse();
          }
          await documentEvidence(this,taskId,v.documentAnalysisId,v.documentEvidence);
          // The user can update Wiki or its Claims while the pointer or document
          // check yields. Approval alone cannot authorize input from stale rules.
          await validateWikiEvidence(this,taskId,v.wikiEvidence||[]);
          // Pointer movement/pulse and source reads yield to the user. Recheck
          // every approved target and value immediately before native dispatch.
          if(bound(this,taskId).id!==v.bindingId||Date.now()>v.expiresAt||!same(v.identity,await a.status(v.identity.hwnd))||!same(v.target,await a.property(v.identity.hwnd,v.selector)))fail('computer_target_changed');
          if(v.action==='drag'&&!same(v.destination,await a.property(v.identity.hwnd,v.destinationSelector)))fail('computer_target_changed');
          if(await valueChanged())fail('computer_target_changed');
          taskReady(this,taskId);issued=true;this.computerFallback=null;
          if(!alreadyMatched)await a.act(v.identity.hwnd,v.target.resolvedSelector,v.action,v.value,{pointerConsent:sharedPointer&&pointerConsent===true,keyboardConsent:keyboard&&keyboardConsent===true,destinationSelector:v.destination?.resolvedSelector,keys:v.keys,direction:v.direction,amount:v.amount});
          v.execution=alreadyMatched?'already_at_target':'command_returned';
        }finally{
          const hidden=await pointer?.hide();
          if(v.pointerDisplay?.available&&hidden?.available!==true)fail('computer_pointer_hide_failed');
        }
        taskReady(this,taskId);
        if(!same(v.identity,await a.status(v.identity.hwnd)))fail('computer_target_changed');
        if(v.action==='set_value')v.verification=await a.value(v.identity.hwnd,v.selector)===v.value?'value_matched':'value_mismatch';
        if(expected){
          const readback=await a.property(v.identity.hwnd,v.selector);
          if(readback.resolvedSelector!==v.target.resolvedSelector)fail('computer_target_changed');
          v.controlCheck={...checkControlState(v.action,readback),at:stamp()};v.verification=v.controlCheck.verification;
        }
        await readInputBack(a,v);
        // Navigation may remove the clicked control. Observe the bound window, not the old target.
        const afterObservation={identity:v.identity,...await a.inspect(v.identity.hwnd),at:stamp(),historical:true};
        const after=await a.capture(v.identity.hwnd,['set_value','type_text'].includes(v.action)&&onScreen(v.target.element)?v.selector:undefined),images=this.store.get('computer-image:'+id);
        if(!same(v.identity,await a.status(v.identity.hwnd)))fail('computer_target_changed');
        v.visualDifference=after.scope===images.before.scope?imageDifference(images.before,after):{state:'scope_changed',verification:'not_verified'};this.store.set('computer-image:'+id,{...images,after,afterObservation});
        v.state=['value_mismatch','state_mismatch','state_unavailable'].includes(v.verification)?'attention':'observed';
      }catch(error){v.state=issued?'attention':'stale';v.execution ||= issued?'unknown':'not_started';v.error=issued?'computer_outcome_unknown':['wiki_evidence_stale','computer_document_required','computer_document_stale'].includes(error.message)?error.message:'computer_target_changed';}
      v.finishedAt=stamp();this.store.set('computer-action:'+id,v);return computerState(this);
    });
  }
  taskReady(this,taskId);
  return exclusive(this,async()=>{
    if(method==='register_app'){
      if(!a.availability().available)fail('computer_unavailable');
      const app=await launcher(this).inspect(file);taskReady(this,taskId);
      this.computerApps ||=new Map();
      const existing=[...this.computerApps.values()].find(v=>v.taskId===taskId&&v.path===app.path&&v.sha256===app.sha256);
      if(!existing){if(this.computerApps.size>=30)fail('computer_app_limit');const entry={...app,id:randomUUID(),taskId};this.computerApps.set(entry.id,entry);}
      return computerState(this);
    }
    if(method==='remove_app'){const app=this.computerApps?.get(appId);if(!app||app.taskId!==taskId)fail('computer_invalid');this.computerApps.delete(appId);return computerState(this);}
    if(method==='windows')return {windows:await a.windows()};
    if(method==='unbind'){this.computerBinding=null;this.computerObservation=null;this.computerFallback=null;await this.computerPointer?.hide();return computerState(this);}
    if(method==='bind'){
      const task=this.task(taskId),request=task.computerConnectionRequest;
      if(task.question)fail('question_pending');
      if(requestId!==undefined&&(!request||request.id!==requestId||!pendingComputerConnection(task)))fail('computer_connection_changed');
      if(!hwnd(window))fail('computer_invalid');
      const status=await a.status(window);taskReady(this,taskId);if(requestId!==undefined&&this.task(taskId).computerConnectionRequest?.id!==requestId)fail('computer_connection_changed');if(expectedIdentity&&!same(expectedIdentity,status))fail('computer_target_changed');
      this.computerBinding={id:randomUUID(),taskId,identity:status};this.computerObservation=null;this.computerFallback=null;
      if(requestId!==undefined){task.computerConnectionRequest={...request,state:'connected',bindingId:this.computerBinding.id,connectedAt:stamp()};this.store.set('task:'+taskId,task);}
      await this.computerPointer?.hide();return computerState(this);
    }
    fail('computer_invalid');
  });
}
