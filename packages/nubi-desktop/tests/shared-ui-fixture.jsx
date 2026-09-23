// Synthetic provider states only. No credentials, external network or claimed model success.
import React from 'react';
import {ComputerUiFixture,ComputerControlUiFixture,ComputerPointerUiFixture} from './computer-ui-fixture.jsx';
import {createRoot} from 'react-dom/client';
import {Workbench} from '../ui/Workbench.jsx';
import '@e2e/cx-design-system/styles.css';
import '../extension/lib/browser/style/style.css';
let selected='aipro',connected=false,pending=null,model='qwen-fixture';
const models=[{id:'qwen-fixture',label:'Qwen fixture',contextLength:32000},{id:'second-exact-id',label:'Second fixture',contextLength:64000}];
const project={projectId:'fixture',name:'검증 프로젝트',branch:'main',files:[],wikiFiles:[],tasks:[],proposals:[],processes:[],comparisons:[],profiles:[{id:'bash',label:'Bash'}]};
const status=()=>({provider:selected,providers:Object.entries({aipro:'AI Pro',chatgpt:'ChatGPT',fabrix:'FabriX'}).map(([id,label])=>({id,label,connected:connected&&id===selected})),connected,pending,models:connected?models:[],model:connected?model:'',verified:false});
if(new URLSearchParams(location.search).has('compaction')){connected=true;project.tasks=[{id:'compaction-task',request:'대화 압축 화면 검증',criteria:[],state:'running',messages:[{role:'user',content:'원문 보존 확인: 승인 없이 실행하지 마세요.'}],trace:[],context:{phase:'summarizing'}}];}
if(new URLSearchParams(location.search).has('elevation')){connected=true;project.tasks=[{id:'elevation-task',request:'관리자 승인 화면 검증',criteria:[],state:'review',messages:[],trace:[]}];project.setupActions=['approve','reject'].map(id=>({id,taskId:'elevation-task',title:id==='approve'?'관리자 실행 검증':'관리자 실행 거절',reason:'합성 승인 흐름 검사',privilege:'administrator',privilegeReason:'시스템 범위 변경 필요',script:'Write-Output "fixture"',profile:'powershell',workspace:'C:\\fixture',effects:'검증용 합성 요청',verification:'실제 결과 확인',references:[],fingerprint:id,state:'proposed'}));}
async function api(method,args={}){
  if(method==='provider'){
    const {action='status',input={}}=args;
    if(action==='login'){selected=input.provider;pending=selected;setTimeout(()=>{pending=null;connected=true;},200);}
    if(action==='cancel'){pending=null;connected=false;}
    if(action==='select')selected=input.provider;
    if(action==='model')model=input.model;
    if(action==='disconnect')connected=false;
    return status();
  }
  if(method==='fabrix'){
    if(args.method==='TEST_FABRIX')return {testId:args.testId,modelCount:2};
    if(args.method==='CONNECT_FABRIX'){selected='fabrix';connected=true;const task=project.tasks[0];if(task){task.state='running';setTimeout(()=>{task.messages.push({role:'assistant',content:'연결 후 대기 중인 오류 분석을 확인한 합성 결과입니다.'});task.state='review';},400);}return {connected:true};}
    return {cancelled:true};
  }
  if(method==='decideSetupAction'){const action=project.setupActions.find(a=>a.id===args.id);if(args.decision==='approve'&&args.elevationConsent!==true)throw Error('elevation_approval_required');action.state=args.decision==='approve'?'started':'rejected';if(action.state==='started')project.tasks[0].messages.push({role:'assistant',content:'합성 관리자 승인 전달을 확인했습니다. 실제 UAC 실행은 하지 않았습니다.'});return action;}
  if(method==='stopAgent'){project.tasks[0].state='cancelled';project.tasks[0].context.phase='ready';return project.tasks[0];}
  if(method==='overview'||method==='state')return structuredClone(project);
  if(method==='createTask'){const task={id:'fixture-task',request:args.request,requirementId:'REQ-fixture',criteria:[],state:'draft',messages:[],trace:[]};project.tasks=[task];return task;}
  if(method==='startAgent'){const task=project.tasks[0];if(args.answer)task.messages.push({role:'user',content:args.answer});task.messages.push({role:'assistant',content:'이 응답은 화면 흐름 검증용 합성 응답입니다.'});task.state='review';return {taskId:task.id,state:'review'};}
  throw new Error('fixture_method_invalid');
}
createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('pointer')?<ComputerPointerUiFixture/>:new URLSearchParams(location.search).has('controls')?<ComputerControlUiFixture/>:new URLSearchParams(location.search).has('computer')?<ComputerUiFixture/>:<Workbench api={api} openCurrent={async()=>project} chooseFolder={()=>{}} openPath={()=>{}} review={()=>{}} apply={()=>{}} openURI={()=>{}} openBrowser={()=>{}}/>);
