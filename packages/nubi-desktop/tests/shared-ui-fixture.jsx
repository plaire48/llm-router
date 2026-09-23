// Synthetic provider states only. No credentials, external network or claimed model success.
import React from 'react';
import {ComputerUiFixture} from './computer-ui-fixture.jsx';
import {createRoot} from 'react-dom/client';
import {Workbench} from '../ui/Workbench.jsx';
import '@e2e/cx-design-system/styles.css';
import '../extension/lib/browser/style/style.css';
let selected='aipro',connected=false,pending=null,model='qwen-fixture';
const models=[{id:'qwen-fixture',label:'Qwen fixture',contextLength:32000},{id:'second-exact-id',label:'Second fixture',contextLength:64000}];
const project={projectId:'fixture',name:'검증 프로젝트',branch:'main',files:[],wikiFiles:[],tasks:[],proposals:[],processes:[],comparisons:[],profiles:[{id:'bash',label:'Bash'}]};
const status=()=>({provider:selected,providers:Object.entries({aipro:'AI Pro',chatgpt:'ChatGPT',fabrix:'FabriX'}).map(([id,label])=>({id,label,connected:connected&&id===selected})),connected,pending,models:connected?models:[],model:connected?model:'',verified:false});
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
  if(method==='overview'||method==='state')return structuredClone(project);
  if(method==='createTask'){const task={id:'fixture-task',request:args.request,requirementId:'REQ-fixture',criteria:[],state:'draft',messages:[],trace:[]};project.tasks=[task];return task;}
  if(method==='startAgent'){const task=project.tasks[0];if(args.answer)task.messages.push({role:'user',content:args.answer});task.messages.push({role:'assistant',content:'이 응답은 화면 흐름 검증용 합성 응답입니다.'});task.state='review';return {taskId:task.id,state:'review'};}
  throw new Error('fixture_method_invalid');
}
createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('computer')?<ComputerUiFixture/>:<Workbench api={api} openCurrent={async()=>project} chooseFolder={()=>{}} openPath={()=>{}} review={()=>{}} apply={()=>{}} openURI={()=>{}} openBrowser={()=>{}}/>);
