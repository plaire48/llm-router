// Render the production components with explicit sample data. No account, model,
// database or native-write success is inferred from this visual fixture.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DetailPanel} from '@e2e/cx-design-system';
import {NubiLogo} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {UsagePanel} from '../../../extensions/aipro-chat/src/UsagePanel.jsx';
import {ModelSelection} from '../../../extensions/aipro-chat/src/ChatControls.jsx';
import {QuestionForm} from '../../../extensions/aipro-chat/src/QuestionForm.jsx';
import {StartupConnections} from '../ui/StartupConnections.jsx';
import {MailLibrary} from '../ui/MailLibrary.jsx';
import {MailHistory} from '../ui/MailHistory.jsx';
import {MailFilterDialog,DEFAULT_MAIL_FILTERS} from '../ui/MailSearchToolbar.jsx';
import {SavedMailSearches} from '../ui/SavedMailSearches.jsx';
import {SkillLibrary} from '../ui/SkillLibrary.jsx';
import {DESKTOP_PROVIDER_LABELS} from '../ui/provider-labels.mjs';
import {CustomSkills} from '../ui/CustomSkills.jsx';
import {SkillMarketplace} from '../ui/SkillMarketplace.jsx';
import {SkillRegistration} from '../ui/SkillRegistration.jsx';
import {WikiUpdate} from '../ui/WikiUpdate.jsx';
import {AnalysisHistory} from '../ui/AnalysisHistory.jsx';
import {DocumentAnalysisProgress} from '../ui/DocumentAnalysisProgress.jsx';
import {SetupActions} from '../ui/SetupActions.jsx';
import {AppliedFileChanges} from '../ui/AppliedFileChanges.jsx';
import {ClaudeConnection} from '../ui/ClaudeConnection.jsx';
import {ReasoningPicker} from '../ui/ReasoningPicker.jsx';
import {GhesAccount} from '../ui/GhesAccount.jsx';
import {MailProgress} from '../ui/MailProgress.jsx';
import {WorkspaceToast} from '../ui/WorkspaceToast.jsx';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
const params=new URLSearchParams(location.search),screen=params.get('screen')||'workbench';
const modelRows=Array.from({length:40},(_,i)=>({id:`model-${i}`,name:`model-${i}`,label:`업무 문서를 분석하는 모델 ${i+1}`,displayName:`업무 문서를 분석하는 모델 ${i+1}`,contextLength:32000}));
const provider={provider:'aipro',connected:true,model:'model-0',models:modelRows,providers:[{id:'aipro',connected:true},{id:'chatgpt',connected:false},{id:'fabrix',connected:false}]};
const mailRows=Array.from({length:4},(_,i)=>({id:`mail-${i}`,subject:`주간 보고서와 승인 일정 ${i+1}`,from:'업무지원 <team@example.invalid>',date:'2026-10-09T01:00:00Z',state:'saved',excerpt:'결과를 먼저 확인하고 변경 대상과 다음 행동을 정리해 주세요.',attachments:[{id:'attachment',filename:'업무 보고서.pptx',contentState:'document_attention',error:'document_office_required'}]}));
let mail={connected:true,autoWiki:true,serverProfile:'company',counts:{received:4,queued:1,saved:3,attention:1},messages:mailRows,total:4,destination:{provider:'aipro',model:'model-0'},activeModel:{provider:'aipro',model:'model-0'},catalogs:[{provider:'aipro',models:modelRows.slice(0,2)}],storageRoot:'/sample/personal',progress:{stage:'attention',completed:3,remaining:1,queued:1,attention:1}};
const skill={name:'report',title:'보고서 작성',path:'.nubi/skill/report/SKILL.md',description:'회사 양식과 출처를 확인하고 핵심 결과와 다음 행동을 정리합니다.',managed:true,packageHash:'sample'};
const analysis={id:'analysis',state:'partial',question:'업무 문서의 승인 단계와 예외를 확인해 주세요.',completed:1,total:2,sources:[{id:'guide',path:'docs/업무-지침.md'}],workers:[{taskId:0,role:'research',phase:'finished',outcome:'complete',summary:'승인 대상과 보존 조건을 확인했습니다.',range:{documentId:'guide',start:0,end:6000}},{taskId:1,role:'research',phase:'finished',outcome:'partial',summary:'예외 처리 구간은 아직 읽지 못했습니다.',range:{documentId:'guide',start:6000,end:12000}}],coverage:{unreadRanges:[{documentId:'guide',start:9000,end:12000}]}};
async function api(method,args={}){
 if(method==='mail'){
  if(args.action==='facets')return {senders:[{address:'team@example.invalid',label:'업무지원'}],tags:['승인'],saved:[{id:'saved',name:'승인 메일',query:'승인',filters:{},sort:'newest'}]};
  if(args.action==='search'||args.action==='query')return {scope:'personal-mail',query:args.query||'',filters:args.filters||{},sort:'newest',results:mailRows.map(row=>({...row,title:row.subject,sourceId:row.id,sourceHash:'sample',excerpt:row.excerpt,attachmentCount:1,matches:[]})),total:4,totalPages:1,page:0,offset:0,currentCursor:null,nextCursor:null,reset:false,scanned:4,collected:4,saved:3,pending:1,unavailable:[],viewKey:'sample',signature:'sample'};
  if(args.action==='read')return {id:args.id,sourceHash:'sample',mail:{...mailRows.find(row=>row.id===args.id),text:'이번 주 핵심 결과를 공유합니다.\n\n변경 대상: 업무 보고서\n다음 행동: 승인 일정 확인\n\n첨부의 Office 읽기는 아직 확인이 필요합니다.'},local:{tags:['승인'],pinned:false}};
  if(args.action==='setAutoWiki')mail={...mail,autoWiki:args.enabled};
  if(args.action==='disconnect')mail={...mail,connected:false};
  if(args.action==='updateLocal')return {...args.patch};
  if(args.action==='saveSearch')return {...args,id:'new-search'};
  return structuredClone(mail);
 }
 if(method==='listSkills')return {skills:params.has('empty')?[]:params.has('many')?Array.from({length:11},(_,index)=>({...skill,id:'skill-'+index,name:'skill-'+index,title:'스킬 '+(index+1)})):[skill],issues:[],truncated:false};
 if(method==='skillTrash')return {items:[{...skill,id:'trash',removedAt:'2026-10-09T01:00:00Z'}]};
 if(method==='removeSkill')return {...skill};
 if(method==='chooseSkillPackage')return {cancelled:true};
 if(method==='skillMarketplace')return {credentialsReady:!params.has('guest'),loginRequired:params.has('guest'),items:[{id:'report',name:'report',title:skill.title,description:skill.description,version:'1.2.0',state:'installed',updateAvailable:true,commit:'sample'},{id:'review',name:'review',title:'승인 검토',description:'변경 영향과 승인 대상, 아직 확인하지 못한 결과를 구분합니다.',version:'1.0.0',state:'available',commit:'sample'}],installed:[{id:'report',name:'report',version:'1.0.0',state:'installed'}]};
 if(method==='wikiUpdate'){
  const state=params.get('state')||'current';
  return {status:{state:state==='current'?'current':'stale',lastUpdate:{updatedAt:'2026-10-09'},changedFiles:['src/업무.js'],uncommitted:['draft.txt'],stalePages:[{path:'openwiki/업무-지침.md',freshness:'source_changed'}]},updates:['ready','failed','running'].includes(state)?[{id:'update',state,changes:[{path:'openwiki/업무-지침.md',change:'modified'}],error:'model_unavailable',outside:['draft.txt'],events:[{type:'progress',stage:'generating',index:1,total:2,page:'업무-지침.md'}]}]:[]};
 }
 if(method==='analysisHistory')return {records:[{...analysis,kind:'document'}],next:null};
 if(method==='appliedFileSummary')return {files:[{path:'src/업무.js',state:'verified',stats:{state:'counted',added:3,removed:1}}],total:1,totals:{added:3,removed:1}};
 if(method==='provider')return {...provider};
 throw Error('unsupported_sample_method:'+method);
}
const no=()=>{},dialog=(title,child)=><DetailPanel title={title} variant="modal" className="deck-dialog nubi-panel" onClose={no}>{child}</DetailPanel>;
function Samples(){
 const [accountOpen,setAccountOpen]=useState(true);
 if(screen.startsWith('claude-'))return <ClaudeConnection initialIssue={{'claude-install':'claude_cli_missing','claude-login':'claude_login_required','claude-update':'claude_cli_update'}[screen]} api={api} onClose={no} onConnected={no} openWebPage={no}/>;
 if(screen==='startup')return <StartupConnections onConnect={no} onClose={no}/>;
 if(screen==='mail-settings')return dialog('메일 설정',<MailLibrary api={api} provider={provider} onProviderAction={no} onProviderLogin={no}/>);
 if(screen==='mail')return <MailHistory api={api} onSettings={no} onDocument={no} onAsk={no} onAskSearch={no} onReturn={no}/>;
 if(screen==='mail-filters')return <MailFilterDialog filters={DEFAULT_MAIL_FILTERS} facets={{senders:[],tags:[]}} initial="period" onApply={value=>{window.appliedMailFilters=value;}} onClose={no}/>;
 if(screen==='mail-saved')return <SavedMailSearches api={api} query="승인" filters={DEFAULT_MAIL_FILTERS} sort="newest" onApply={no} onClose={no}/>;
 if(screen==='skills')return dialog('스킬 관리',<SkillLibrary api={api} openPath={no} onRegister={no}/>);
 if(screen==='marketplace')return dialog('스킬 관리',<SkillMarketplace api={api} openPath={no} connectMarketplace={async()=>({loginRequired:true})} openTeamWorkspace={no}/>);
 if(screen==='registration')return dialog('스킬 등록',<SkillRegistration api={api} onBusy={no} onRegistered={no}/>);
 if(screen==='models-long')return <ModelSelection showActionLabels data={{activeProvider:'aipro',connections:{aipro:{present:true}},catalogs:{aipro:{models:modelRows}},selectedModels:{aipro:'model-0'}}} title="모델 선택" showProviderNames providerLabels={DESKTOP_PROVIDER_LABELS} onClose={no} onSelect={async()=>{}} onRefresh={no} onProviderSelect={no} onLogin={no}/>;
 if(screen==='usage')return <UsagePanel showActionLabels data={{auth:{provider:'aipro',present:true},connections:{},usage:{today:{aipro:{calls:3,measured:2,total:18300,input:18000,output:300}},total:{aipro:{calls:5,measured:4,total:32200,input:31600,output:600}}}}} scopeLabel="이 앱에서 사용한 토큰" onClose={no}/>;
 if(screen==='question')return <QuestionForm showActionLabels question={{id:'question',kind:'choice',text:'어떤 문서를 기준으로 정리할까요?',options:[{id:'current',label:'현재 보고서'},{id:'template',label:'회사 양식'}],inputPlaceholder:'다른 기준을 입력해 주세요'}} onChoose={no}/>;
 if(screen==='wiki')return dialog('프로젝트 자료',<WikiUpdate api={api} openPath={no}/>);
 if(screen==='analysis')return <AnalysisHistory api={api} task={{id:'sample',state:'review',trace:[],documentAnalysis:analysis}}/>;
 if(screen==='setup')return <SetupActions actions={[{id:'command',taskId:'sample',title:'테스트 실행',reason:'수정한 파일을 테스트로 확인합니다.',script:'npm test',profile:'bash',workspace:'/sample/project',effects:'현재 프로젝트의 테스트를 실행합니다.',verification:'종료 코드와 실패 건수를 확인합니다.',fingerprint:'sample',state:'proposed',references:[]}]} proposals={[]} onAlways={no} onDecision={no} onResult={no}/>;
 if(screen==='applied')return <AppliedFileChanges api={api} taskId="sample" receipts={[{id:'sample',path:'src/업무.js'}]} onOpen={no}/>;
 if(screen==='reasoning')return <ReasoningPicker provider={{...provider,provider:'chatgpt',model:'gpt-5.4',reasoningEffort:'medium'}} api={api} onProvider={no}/>;
 if(screen==='account')return <GhesAccount open={accountOpen} onOpen={()=>setAccountOpen(true)} onClose={()=>setAccountOpen(false)} account={async()=>({state:'connected',connected:true,profile:{name:'검토 계정',login:'review',company:'예시 회사'}})} updates={async()=>({state:'restart_required',supported:true,installedVersion:'1.1.1',availableVersion:'1.1.2'})} repositories={no}/>;
 if(screen==='progress')return <MailProgress api={api} wiki={{state:'running',id:'wiki',stage:'generating',percent:50,completed:1,total:2,startedAt:'2026-10-09T01:00:00Z'}}/>;
 return null;
}
if(screen==='workbench')await import('./shared-ui-fixture.jsx');
else createRoot(document.getElementById('root')).render(<><header className="nubi-bar"><NubiLogo size={28} product="Workspace" versionLabel="Beta"/></header><main className="nubi-workbench"><div className="nubi-main"><Samples/></div></main><WorkspaceToast/></>);
