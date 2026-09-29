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
if(new URLSearchParams(location.search).has('sessions')){
  connected=true;project.projectId='sessions-fixture';project.name='세션 검증 프로젝트';
  const now=new Date(),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
  project.tasks=[
    {id:'session-running',request:'실행 중인 분석',criteria:[],state:'running',createdAt:now.toISOString(),messages:[],trace:[]},
    {id:'session-review',request:'수정할 문서 확인',criteria:[],state:'review',createdAt:yesterday.toISOString(),messages:[],trace:[]},
    {id:'session-older',request:'지난달 코드 검토',criteria:[],state:'review',createdAt:new Date(2025,0,2).toISOString(),messages:[],trace:[]}
  ];
}
if(new URLSearchParams(location.search).has('connection')){
  connected=true;project.computer={availability:{available:true},apps:[],actions:[],checks:[]};
  project.tasks=[{id:'connection-task',request:'메신저 창의 안내문을 확인해 주세요.',criteria:[],state:'waiting_input',messages:[],trace:[],computerConnectionRequest:{id:'connect-1',state:'pending',reason:'안내문을 읽을 메신저 창을 선택해 주세요.',appHint:'업무 메신저'}}];
  window.connectionCalls=[];
}
if(new URLSearchParams(location.search).has('compaction')){connected=true;project.tasks=[{id:'compaction-task',request:'대화 압축 화면 검증',criteria:[],state:'running',messages:[{role:'user',content:'원문 보존 확인: 승인 없이 실행하지 마세요.'}],trace:[],context:{phase:'summarizing'}}];}
if(new URLSearchParams(location.search).has('elevation')){connected=true;project.tasks=[{id:'elevation-task',request:'관리자 승인 화면 검증',criteria:[],state:'review',messages:[],trace:[]}];project.setupActions=['approve','reject'].map(id=>({id,taskId:'elevation-task',title:id==='approve'?'관리자 실행 검증':'관리자 실행 거절',reason:'합성 승인 흐름 검사',privilege:'administrator',privilegeReason:'시스템 범위 변경 필요',script:'Write-Output "fixture"',profile:'powershell',workspace:'C:\\fixture',effects:'검증용 합성 요청',verification:'실제 결과 확인',references:[],fingerprint:id,state:'proposed'}));}
if(new URLSearchParams(location.search).has('apply')){connected=true;project.tasks=[{id:'apply-task',request:'준비한 두 파일을 반영하고 결과를 확인해 주세요.',criteria:[],state:'review',messages:[],trace:[]}];project.proposals=['first','second'].map(id=>({id,taskId:'apply-task',path:id+'.txt',reason:'검토할 변경안',state:'proposed'}));}
if(new URLSearchParams(location.search).has('document')){
  connected=true;const partial=new URLSearchParams(location.search).get('document')==='partial';
  project.tasks=[{id:'document-task',request:'긴 업무 문서의 요구사항을 나눠 확인해 주세요.',criteria:[],state:partial?'review':'running',messages:[],trace:[],documentAnalysis:{id:'document-analysis',state:partial?'partial':'running',question:'승인 단계와 예외를 비교합니다.',phase:'synthesizing',completed:2,total:3,sources:[{id:'guide',path:'docs/업무-요구사항.md',hash:'fixture',characters:18000}],workers:[{taskId:0,role:'research',phase:'finished',outcome:'complete',summary:'승인 단계의 원문을 확인했습니다.',range:{documentId:'guide',start:0,end:6000}},{taskId:1,role:'research',phase:'finished',outcome:'partial',summary:'예외 처리 구간이 남아 있습니다.',range:{documentId:'guide',start:6000,end:12000}},{taskId:'synthesis:0',role:'synthesis',phase:'synthesizing',documentIds:['guide']}],...(partial?{coverage:{unreadRanges:[{documentId:'guide',start:12000,end:18000}]}}:{})}}];
}
if(new URLSearchParams(location.search).get('document')?.startsWith('history')){
  project.tasks[0].checkpoint={runId:'role-run'};
  project.tasks[0].trace=[{id:'role-run:0:role-worker',at:'2026-09-25T02:00:00.000Z',tool:'analysis_page',status:'running',analysis:{task:'저장 결과 화면을 확인합니다.',phase:'reading',calls:2,reads:1,doneWhen:'화면의 저장 상태 확인',sources:[{id:'screen',kind:'computer',tool:'read_computer_result',hasImage:true,historical:true,read:true,imageRead:true}]}}];
}
if(new URLSearchParams(location.search).get('document')==='history-resume'){project.tasks[0].checkpoint={runId:'resumed-run'};}
let historyFailure=true;
let handoffFinished=false;
if(new URLSearchParams(location.search).get('document')==='history-handoff'){
  project.tasks[0].trace=[];
  window.finishHandoffFixture=()=>{handoffFinished=true;};
}
async function api(method,args={}){
  if(method==='computer'&&new URLSearchParams(location.search).has('connection')){
    window.connectionCalls.push(structuredClone(args));const task=project.tasks[0],request=task.computerConnectionRequest;
    if(args.taskId!==task.id)throw Error('wrong_task');
    if(args.method==='windows'&&window.connectionFail)throw Error('computer_command_failed');
    if(args.method==='windows')return {windows:[{hwnd:77,title:'업무 메신저',processName:'Messenger'}]};
    if(args.requestId!==request.id)throw Error('wrong_request');
    if(args.method==='save_connection_draft')request.draft=args.draft;
    if(args.method==='answer_connection'){request.state='answered';task.state='review';task.messages.push({role:'user',content:args.text});}
    if(args.method==='bind'){project.computer.binding={taskId:task.id,processName:'Messenger',windowTitle:'업무 메신저'};request.state='connected';}
    if(args.method==='continue_connection'){request.state='resolved';task.state='review';task.messages.push({role:'assistant',content:'연결한 창에서 같은 작업을 이어가는 합성 응답입니다.'});}
    if(args.method==='cancel_connection'){request.state='cancelled';task.state='cancelled';project.computer.binding=null;}
    return structuredClone(project.computer);
  }
  if(method==='analysisHistory'){
    const mode=new URLSearchParams(location.search).get('document');
    if(mode==='history-error'&&historyFailure){historyFailure=false;throw Error('fixture_history_failure');}
    const task=project.tasks.find(item=>item.id===args.taskId);
    const latest=task?.documentAnalysis;
    if(!latest)return {records:[],next:null};
    if(mode==='history-resume')return {records:[{kind:'roles',id:'role-run',runId:'role-run',state:'interrupted',workers:task.trace.map(worker=>({...worker,status:'interrupted',analysis:{...worker.analysis,phase:'finished'}}))}],next:null};
    if(mode==='history-handoff'){
      const role={kind:'roles',id:'old-role',state:handoffFinished?'partial':'running',workers:[{id:'old-worker',tool:'analysis_review',status:handoffFinished?'done':'running',analysis:{task:'이전 분담의 저장 결과 확인',phase:handoffFinished?'finished':'reading',outcome:'partial',delivered:handoffFinished,calls:2,reads:1,uncertainties:handoffFinished?['저장 후 다시 열기는 미확인입니다.']:[],nextStep:handoffFinished?'파일을 다시 열어 값을 확인합니다.':''}}]};
      const review={kind:'review',id:'review-fixture',state:'revise',round:1,advisoryCount:1,omittedHandoffs:1,omittedUnresolvedHandoffs:1,nextStep:'저장된 결과를 다시 확인합니다.',checks:[{requirementId:'fixture',state:'unknown',detail:'파일 재열기 근거가 없습니다.'}]};
      return {records:args.before?[role]:[{...latest,kind:'document'},review],updates:args.refresh?.some(item=>item.kind==='roles'&&item.id===role.id)?[role]:[],next:args.before?null:'older'};
    }
    if(mode?.startsWith('history')){
      const previous=index=>({...latest,kind:'document',id:'previous-'+index,state:'partial',question:'이전 문서 조사 '+index,phase:'synthesis_finished',workers:[{taskId:'older-'+index,role:'research',phase:'finished',outcome:'partial',summary:'이전 조사 기록 '+index}],coverage:{unreadRanges:[{documentId:'guide',start:12000,end:18000}]}});
      if(args.before)return {records:[previous(2)],next:null};
      return {records:[{...latest,kind:'document'},{kind:'roles',id:'role-run',runId:'role-run',state:task.state==='running'?'running':'interrupted',workers:task.state==='running'?task.trace.map(worker=>({...worker,at:'2026-09-25T01:00:00.000Z',status:'running',analysis:{...worker.analysis,calls:0,reads:0}})):task.trace},previous(1)],next:'older'};
    }
    return {records:[{...latest,kind:'document'}],next:null};
  }
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
  if(method==='stopAgent'){project.tasks[0].state='cancelled';if(project.tasks[0].context)project.tasks[0].context.phase='ready';if(project.tasks[0].documentAnalysis)project.tasks[0].documentAnalysis.state='cancelled';return project.tasks[0];}
  if(method==='overview'||method==='state')return structuredClone(project);
  if(method==='createTask'){const task={id:'fixture-task',request:args.request,requirementId:'REQ-fixture',criteria:[],state:'draft',messages:[],trace:[]};project.tasks=[task];return task;}
  if(method==='startAgent'){const task=project.tasks[0];task.workPlan={steps:[{text:'현재 문구 확인',expected_outcome:'변경할 문구와 유지할 조건을 확인합니다.',status:'in_progress'},{text:'수정안과 확인 결과 정리',expected_outcome:'변경안과 아직 확인하지 못한 결과를 구분합니다.',status:'pending'}]};if(args.answer)task.messages.push({role:'user',content:args.answer});task.messages.push({role:'assistant',content:'**핵심 내용을 먼저 보여줍니다.**\n\n이 응답은 화면 흐름 검증용 합성 응답입니다. **실제 모델 결과가 아닙니다.**'});task.state='review';return {taskId:task.id,state:'review'};}
  throw new Error('fixture_method_invalid');
}
createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('pointer')?<ComputerPointerUiFixture/>:new URLSearchParams(location.search).has('controls')?<ComputerControlUiFixture/>:new URLSearchParams(location.search).has('computer')?<ComputerUiFixture/>:<Workbench api={api} openCurrent={async()=>project} chooseFolder={()=>{}} openPath={()=>{}} review={()=>{}} apply={async id=>{const proposal=project.proposals.find(p=>p.id===id);if(proposal)proposal.state='applied';}} openURI={()=>{}} openBrowser={()=>{}}/>);
