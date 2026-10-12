import {searchConversations} from '../ui/conversation-search.mjs';
// Synthetic provider states only. No credentials, external network or claimed model success.
import React,{useState} from 'react';
import {createPortal} from 'react-dom';
import {WorkspaceAction} from '../ui/WorkspaceAction.jsx';
import {MailSourcePane} from '../ui/MailSourcePane.jsx';
import {ComputerUiFixture,ComputerControlUiFixture,ComputerPointerUiFixture,ComputerKeyboardUiFixture} from './computer-ui-fixture.jsx';
import {createRoot} from 'react-dom/client';
import {Workbench} from '../ui/Workbench.jsx';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
let selected='aipro',connected=false,pending=null,model='qwen-fixture',catalogAt=1;
if(new URLSearchParams(location.search).has('catalog')){connected=true;window.catalogCalls=0;window.catalogDelay=0;window.catalogFailure=false;}
const models=[{id:'qwen-fixture',label:'Qwen fixture',contextLength:32000},{id:'second-exact-id',label:'Second fixture',contextLength:64000}];
// A project whose OpenWiki exists: without wiki files or a running initialization the Workbench shows the project start screen instead of the composer (2026-10-05).
const project={projectId:'fixture',name:'검증 프로젝트',branch:'main',files:[],wikiFiles:['openwiki/업무-지침.md'],tasks:[],proposals:[],processes:[],comparisons:[],profiles:[{id:'bash',label:'Bash'}]};
if(new URLSearchParams(location.search).has('solution')){project.peerTasks=[{id:'design-request',recipient:'desktop',state:'submitted'}];window.nativeViewCalls=[];}
const status=()=>({modelCatalog:{fetchedAt:catalogAt},provider:selected,providers:Object.entries({aipro:'AI Pro',chatgpt:'ChatGPT',fabrix:'FabriX'}).map(([id,label])=>({id,label,connected:connected&&id===selected})),connected,pending,models:connected?models:[],model:connected?model:'',verified:false});
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
if(new URLSearchParams(location.search).has('compaction')){connected=true;project.tasks=[{id:'compaction-task',request:'대화 압축 화면 검증',criteria:[],state:'running',checkpoint:{runId:'compaction-run'},/* activity is shown per run (2026-10-02) */messages:[{role:'user',content:'원문 보존 확인: 승인 없이 실행하지 마세요.',runId:'compaction-run'}],trace:[],context:{phase:'summarizing'}}];}
if(new URLSearchParams(location.search).has('elevation')){connected=true;project.tasks=[{id:'elevation-task',request:'관리자 승인 화면 검증',criteria:[],state:'review',messages:[],trace:[]}];project.setupActions=['approve','reject'].map(id=>({id,taskId:'elevation-task',title:id==='approve'?'관리자 실행 검증':'관리자 실행 거절',reason:'합성 승인 흐름 검사',privilege:'administrator',privilegeReason:'시스템 범위 변경 필요',script:'Write-Output "fixture"',profile:'powershell',workspace:'C:\\fixture',effects:'검증용 합성 요청',verification:'실제 결과 확인',references:[],fingerprint:id,state:'proposed'}));}
// A check proposed with its fix (2026-09-30): the run button waits for the fix; always allow sits beside it.
if(new URLSearchParams(location.search).has('command')){connected=true;project.tasks=[{id:'command-task',request:'무료 배송 기준을 고치고 테스트로 확인해 주세요.',criteria:[],state:'review',messages:[],trace:[]}];project.proposals=[{id:'fix',taskId:'command-task',path:'src/shipping.mjs',reason:'무료 배송 기준을 정책 값 50,000원으로 되돌립니다.',state:'proposed'}];project.setupActions=[{id:'check',taskId:'command-task',title:'테스트 실행',kind:'verify',reason:'수정한 배송 기준을 테스트로 확인합니다.',privilege:'user',script:'npm test',profile:'bash',workspace:'/fixture/order-service',effects:'파일을 바꾸지 않습니다.',verification:'종료 코드 0과 실패 0건을 확인합니다.',references:[{path:'package.json',hash:'fixture'}],fingerprint:'check',state:'proposed',afterProposals:['fix']}];}
// The composer gauge (2026-09-30): the tokens AI Pro reported for the latest answer, against the model window.
if(new URLSearchParams(location.search).has('progress')){
 connected=true;const runId='progress-run';
 project.tasks=[{id:'progress-task',request:'선택 메일 확인',state:'review',checkpoint:{runId},messages:[{role:'user',content:'선택 메일 확인',runId},{role:'assistant',content:'합성 화면 검증 결과입니다.',runId}],trace:['personal_mail_query','read_personal_mail','read_personal_mail','read_source','wiki_query','review_task'].map((tool,index)=>({id:`${runId}:0:${index}`,runId,tool,status:'done',label:'도구 호출'})),resultReview:{runId,status:'ready',checks:[{requirementId:'REQ-progress',state:'supported',detail:'선택한 원문과 답변의 근거를 대조했습니다.'}]}}];
}
if(new URLSearchParams(location.search).has('context')){connected=true;project.tasks=[{id:'context-task',request:'문맥 사용량 화면 검증',criteria:[],state:'review',messages:[],trace:[],context:{phase:'ready',compactions:1,beforeTokens:215000,afterTokens:61000,usage:{kind:'measured',used:23223,window:262144,prompt:23175,completion:48,reasoning:30,compactAt:213811,model:'qwen-fixture',at:'2026-09-30T12:00:00.000Z'}}}];}
if(new URLSearchParams(location.search).has('composer-stress')){models[0].label='업무 분석을 위한 아주 긴 모델 이름 GPT-6.1-Sol';if(new URLSearchParams(location.search).has('composer-running'))project.tasks[0].state='running';}
if(new URLSearchParams(location.search).has('chat-preview')){
 const task=project.tasks[0];task.request='이번 주 회의 내용을 핵심만 정리해 줘.';
 task.messages=[{role:'assistant',model:'qwen-fixture',content:'확인할 내용은 **세 가지**입니다.\n\n- 일정: 다음 주 수요일까지 초안을 준비합니다.\n- 담당: 각 담당자가 변경 사항을 확인합니다.\n- 다음 단계: 초안을 검토한 뒤 최종 일정을 정합니다.\n\n이 화면은 채팅 배치를 확인하기 위한 예시입니다.'}];
}

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
const modalMail={connected:false,autoWiki:true,serverProfile:'company',counts:{received:0,queued:0,saved:0,attention:0},messages:[],total:0,activeModel:{provider:'aipro',model:'qwen-fixture'},storageRoot:'/fixture/personal'};
if(new URLSearchParams(location.search).has('modals')){project.wikiFiles=['openwiki/업무-지침.md'];project.defaultShell='bash';}
let ghes=new URLSearchParams(location.search).has('company-connected')?{state:'connected',connected:true,profile:{name:'긴 이름의 회사 계정 화면 검토 사용자',login:'fixture-user'}}:{state:'guest',connected:false,profile:null};
const ghesAccount=async operation=>{// the company account dialog of the Electron rail: guest, a device code while connecting, and back (2026-10-07)
  if(operation==='login')ghes=new URLSearchParams(location.search).has('company-login-error')?{state:'guest',connected:false,profile:null,error:'ghes_login_endpoint_unavailable',diagnostic:{stage:'device_code',status:404}}:{state:'connecting',connected:false,profile:null,device:{code:'NUBI-1234'}};
  else if(operation==='cancel'||operation==='logout')ghes={state:'guest',connected:false,profile:null};
  return structuredClone(ghes);
};
const modalsVariant=new URLSearchParams(location.search).has('modals');
const mailFlow=new URLSearchParams(location.search).has('mail-flow');
if(mailFlow)connected=!new URLSearchParams(location.search).has('mail-disconnected');
const flowMails=Array.from({length:47},(_,i)=>({id:String(i+1).padStart(64,'0'),sourceHash:'a'.repeat(64),subject:[`10월 예산 승인 요청 ${i+1}`,`견적서 검토 결과 ${i+1}`,`프로젝트 일정 공유 ${i+1}`][i%3],from:['김누비 <nubi@example.test>','구매팀 <buy@example.test>','프로젝트팀 <team@example.test>'][i%3],to:'업무 담당자 <owner@example.test>',cc:'검토팀 <review@example.test>',date:'2026-10-12T01:00:00Z',text:'확인할 내용과 다음 일정을 공유합니다.\n\n예산안의 변경 항목을 확인해 주세요. 검토 의견은 목요일까지 취합합니다.\n승인 이후 구매 일정을 확정할 예정입니다.\n\n이 메일은 화면 검토용 예시입니다.',attachments:i%3===0?[{id:'attachment',filename:'10월 견적서.pdf',contentState:'document_read',sha256:'b'.repeat(64),coverage:'전체 2쪽 읽음'}]:[]}));
if(mailFlow)flowMails[0].text+='\n\n\n상세 안내 https://example.test/notice?tracking=fixture';
if(new URLSearchParams(location.search).has('conversation-search'))project.tasks=[{id:'bread',request:'아침 식사 추천',state:'review',createdAt:new Date().toISOString(),messages:[{role:'user',content:'간단한 메뉴를 추천해 주세요.'},{role:'assistant',content:'따뜻한 빵과 우유를 추천합니다. 식빵도 좋아요.'}],trace:[],criteria:[]},{id:'other',request:'다른 이야기',state:'review',createdAt:new Date().toISOString(),messages:[{role:'assistant',content:'오늘은 산책하기 좋아요.'}],trace:[],criteria:[]}];
async function api(method,args={}){
  if(method==='conversationHistory')return args.taskId?structuredClone(project.tasks.find(task=>task.id===args.taskId)):searchConversations(project.tasks,args);
  if(mailFlow){
    (window.mailFlowCalls||=[]).push({method,...args});
    if(method==='downloadMail')return {previewOnly:true};
    if(method==='mail'){
      if(args.action==='history')return {messages:flowMails,total:flowMails.length};
      if(args.action==='status')return {connected:true,autoWiki:false,counts:{received:47},progress:{}};
      if(args.action==='facets')return {saved:[],senders:[],tags:[]};
      if(args.action==='updateLocal')return args.patch;
      if(args.action==='read'){const mail=flowMails.find(row=>row.id===args.id);return {id:mail.id,sourceHash:mail.sourceHash,mail,local:{tags:[],pinned:false}};}
      if(args.action==='evidence'){if(window.mailEvidenceFailure===args.id)throw Error('mail_source_changed');if(window.mailEvidenceWait)await new Promise(resolve=>{window.releaseMailEvidence=resolve;});const mail=flowMails.find(row=>row.id===args.id);return {id:mail.id,sourceHash:mail.sourceHash,title:mail.subject,from:mail.from,date:mail.date};}
      if(args.action==='search'){
        const rows=flowMails.filter(row=>!args.query||`${row.subject} ${row.from} ${row.text}`.includes(args.query));
        const size=args.limit||20,total=rows.length,page=Math.max(1,Math.min(args.page||1,Math.ceil(total/size))),offset=(page-1)*size;
        return {results:rows.slice(offset,offset+size).map(row=>({...row,title:row.subject,sourceId:row.id,excerpt:row.text,attachmentCount:row.attachments.length})),total,totalPages:Math.ceil(total/size),page,offset,currentCursor:'fixture-'+page,nextCursor:offset+size<total?'fixture-next':null,unavailable:[]};
      }
    }
  }
  if(new URLSearchParams(location.search).has('modals')){
    if(method==='mail'){// the mail page searches and loads facets on open (2026-10-02)
      if(args.action==='search'||args.action==='query')return {scope:'personal-mail',query:args.query||'',filters:{},sort:'newest',results:[],total:0,totalPages:0,page:0,offset:0,currentCursor:null,nextCursor:null,reset:false,scanned:0,collected:0,saved:0,pending:0,unavailable:[],viewKey:'fixture',signature:'fixture'};
      if(args.action==='facets')return {saved:[],senders:[],tags:[]};
      return structuredClone(modalMail);
    }
    if(method==='listSkills')return {skills:[{name:'보고서 작성',description:'회사 양식과 출처를 확인해 보고서를 작성해요.',path:'.nubi/skill/report/SKILL.md'}],issues:[],truncated:false};
    if(method==='skillTrash')return {items:[]};// the custom skill view loads the trash with the list (2026-10-02)
    if(method==='skillMarketplace'){(window.marketplaceCalls||=[]).push(args);if(args.operation==='install'){await new Promise(resolve=>setTimeout(resolve,window.skillDownloadDelay||0));window.skillDownloaded=args.id;}const result={credentialsReady:true,loginRequired:false,items:[{id:'simple-addition',name:'simple-addition',title:'간단 덧셈',version:'1.2.0',description:'두 수를 더하고 계산 과정을 설명해요.',state:'installed',updateAvailable:true,commit:'c1'},{id:'report-review',name:'report-review',title:'보고서 검토',version:'1.0.0',description:'보고서의 근거와 양식을 확인해요.',state:'available',commit:'c1'}],installed:[{id:'simple-addition',name:'simple-addition',version:'1.0.0',state:'installed'}]};if(window.skillDownloaded){const item=result.items.find(item=>item.id===window.skillDownloaded);if(item){item.state='installed';item.updateAvailable=false;result.installed.push({id:item.id,name:item.name,title:item.title,version:item.version,state:'installed'});}}return result;}// the AI Workspace tab lists the company catalog beside what this project installed (2026-10-07)
    if(method==='wikiUpdate'){const state=window.modalWikiState||'current';return {status:{state:state==='current'?'current':'outdated',lastUpdate:{updatedAt:'2026-10-01'},changedFiles:['src/index.ts'],uncommitted:['draft.txt'],stalePages:[{path:'openwiki/업무-지침.md',freshness:'source_changed'}]},updates:['ready','failed'].includes(state)?[{id:'fixture-update',state,changes:[{path:'openwiki/업무-지침.md',change:'modified'}],error:'model_unavailable'}]:[]};}
    if(method==='knowledgeStatus')return {state:'none'};
  }
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
    if(new URLSearchParams(location.search).has('progress'))return {records:[{...task.resultReview,kind:'review',id:'review-progress',state:'ready'},{kind:'roles',id:'progress-run',runId:'progress-run',state:'complete',workers:[1,2].map(index=>({id:`mail-worker-${index}`,tool:'analysis_research',status:'done',analysis:{task:`선택 메일 ${index}의 원문과 개인 위키 비교`,phase:'finished',reads:1,calls:2,delivered:true,outcome:'complete',summary:`메일 ${index} 대조 결과`,sources:[{id:`mail-evidence-${index}`,tool:'read_personal_mail',kind:'mail',historical:true,read:true}]}}))}],next:null};
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
    if(action==='refresh'){window.catalogCalls=(window.catalogCalls||0)+1;await new Promise(resolve=>setTimeout(resolve,window.catalogDelay||0));if(window.catalogFailure)throw Error('network');catalogAt++;}
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
  if(method==='decideSetupAction'){const action=project.setupActions.find(a=>a.id===args.id);if(args.decision==='approve'&&action.privilege==='administrator'&&args.elevationConsent!==true)throw Error('elevation_approval_required');action.state=args.decision==='approve'?'started':'rejected';if(action.state==='started')project.tasks[0].messages.push({role:'assistant',content:'합성 관리자 승인 전달을 확인했습니다. 실제 UAC 실행은 하지 않았습니다.'});return action;}
  if(method==='stopAgent'){project.tasks[0].state='cancelled';if(project.tasks[0].context)project.tasks[0].context.phase='ready';if(project.tasks[0].documentAnalysis)project.tasks[0].documentAnalysis.state='cancelled';return project.tasks[0];}
  // Automatic approval (2026-09-30): the mode is kept; nothing is waiting, so nothing is approved automatically.
  if(method==='allowCommand'){const action=project.setupActions.find(a=>a.id===args.id);const policy=window.approvalPolicy||={mode:'ask',allowedCommands:[]};if(!policy.allowedCommands.some(item=>item.profile===action.profile&&item.script===action.script))policy.allowedCommands.push({profile:action.profile,script:action.script});return structuredClone(window.approvalPolicy);}
  if(method==='approvalPolicy')return structuredClone(window.approvalPolicy||={mode:'ask',allowedCommands:[{profile:'bash',script:'npm test'}]});
  if(method==='setApprovalMode'){(window.approvalPolicy||={mode:'ask',allowedCommands:[]}).mode=args.mode;(window.approvalCalls||=[]).push(args.mode);return structuredClone(window.approvalPolicy);}
  if(method==='removeAllowedCommand'){window.approvalPolicy.allowedCommands=window.approvalPolicy.allowedCommands.filter(item=>item.script!==args.script);return structuredClone(window.approvalPolicy);}
  if(method==='autoApprovals'){(window.autoApprovalChecks||=[]).push(args.taskId);return {mode:window.approvalPolicy?.mode||'ask',proposals:[],command:null};}
  if(method==='deleteTask'){(window.deletedTasks||=[]).push(args.taskId);project.tasks=project.tasks.filter(task=>task.id!==args.taskId);return {deleted:args.taskId};}
  if(method==='overview'||method==='state'){if(new URLSearchParams(location.search).has('noproject'))throw Error('project_missing');return structuredClone(project);}
  if(method==='createTask'){const task={id:'fixture-task',request:args.request,requirementId:'REQ-fixture',criteria:[],state:'draft',messages:[],trace:[]};project.tasks=[task];return task;}
  if(method==='startAgent'){if(window.slowStart)await new Promise(resolve=>setTimeout(resolve,1500));const task=project.tasks[0];const runId=`fixture-run-${(task.runCount=(task.runCount||0)+1)}`;// activity is shown per run: the plan and messages carry the run id (2026-10-02)
    task.workPlan={runId,steps:[{text:'현재 문구 확인',expected_outcome:'변경할 문구와 유지할 조건을 확인합니다.',status:'in_progress'},{text:'수정안과 확인 결과 정리',expected_outcome:'변경안과 아직 확인하지 못한 결과를 구분합니다.',status:'pending'}]};if(args.answer)task.messages.push({role:'user',content:args.answer,runId});task.messages.push({role:'assistant',content:'**핵심 내용을 먼저 보여줍니다.**\n\n이 응답은 화면 흐름 검증용 합성 응답입니다. **실제 모델 결과가 아닙니다.**',runId});task.state='review';return {taskId:task.id,state:'review'};}
  throw new Error('fixture_method_invalid');
}
const fixtureRoot=document.getElementById('root');
// Use the actual Electron style scope; the all-surfaces host already owns it.
if(new URLSearchParams(location.search).has('integrated')&&!fixtureRoot.closest('.desktop-shell')){const shell=document.createElement('div');shell.className='desktop-shell';shell.dataset.layout='split';fixtureRoot.replaceWith(shell);shell.append(fixtureRoot);fixtureRoot.className='desktop-agent';}
// Exercise the real titlebar portal as well as the rail fallback.
if(new URLSearchParams(location.search).has('toolbar')&&!document.getElementById('toolbar')){const shell=fixtureRoot.closest('.desktop-shell');shell.dataset.toolbar='true';shell.dataset.platform='darwin';const toolbar=document.createElement('div');toolbar.id='toolbar';toolbar.className='desktop-titlebar';shell.prepend(toolbar);}
const wikiFixture=new URLSearchParams(location.search).has('wiki-progress')?{id:'wiki-fixture',state:'running',stage:'generating',startedAt:new Date(Date.now()-60000).toISOString(),stageStartedAt:new Date(Date.now()-30000).toISOString(),completed:3,total:10,percent:30}:undefined;
function WorkbenchFixture(){const [sources,setSources]=useState(null),[wiki,setWiki]=useState(wikiFixture);window.setWikiFixture=setWiki;return <><Workbench wikiInitialization={wiki} openTeamWorkspace={async()=>{(window.nativeViewCalls||=[]).push('team-workspace');}} openMailSources={mailFlow?references=>{window.mailSourceCalls=references;setSources(references);}:undefined} toolbarHost={document.getElementById("toolbar")} hostLayout={new URLSearchParams(location.search).has('integrated')?'integrated':undefined} workspaceView={['solution','modals','integrated'].some(key=>new URLSearchParams(location.search).has(key))?async view=>{(window.nativeViewCalls||=[]).push(view);}:undefined} api={api} openCurrent={async()=>new URLSearchParams(location.search).has('noproject')?null:project} chooseFolder={()=>{}} openPath={()=>{}} review={()=>{}} apply={async id=>{const proposal=project.proposals.find(p=>p.id===id);if(proposal)proposal.state='applied';}} openURI={()=>{}} openBrowser={()=>{}} cloneRepository={async url=>{(window.cloneCalls||=[]).push(url);return {cancelled:true};}} ghesAccount={modalsVariant?ghesAccount:undefined} ghesUpdate={modalsVariant?async()=>({state:'unchecked'}):undefined} ghesRepositories={modalsVariant?async()=>({cancelled:true}):undefined}/>{sources&&createPortal(<aside className="desktop-pane"><header><strong>메일 원문</strong><WorkspaceAction action="close" label="원문 닫기" onClick={()=>setSources(null)}/></header><MailSourcePane references={sources} api={api}/></aside>,fixtureRoot.parentElement)}</>;}
createRoot(fixtureRoot).render(new URLSearchParams(location.search).has('pointer')?<ComputerPointerUiFixture/>:new URLSearchParams(location.search).has('keyboard')?<ComputerKeyboardUiFixture/>:new URLSearchParams(location.search).has('controls')?<ComputerControlUiFixture/>:new URLSearchParams(location.search).has('computer')?<ComputerUiFixture/>:<WorkbenchFixture/>);
