// Synthetic UI states. No Windows programs are started by this fixture.
import React,{useState,useRef} from 'react';
import {ComputerUse} from '../ui/ComputerUse.jsx';

export function ComputerPointerUiFixture(){
  const [count,setCount]=useState(0),stopped=useRef(false);
  const [state,setState]=useState({availability:{available:false},apps:[],checks:[],actions:[{id:'pointer-preview',taskId:'pointer-fixture',fingerprint:'fixture',action:'drag',inputMode:'shared_pointer',state:'proposed',reason:'출발 항목을 도착 위치로 옮깁니다.',target:{element:{name:'출발 항목',type:'Button'}},destination:{element:{name:'도착 위치',type:'Button'}},identity:{windowTitle:'합성 마우스 검증',processName:'Fixture'},pointer:{x:0.5,y:0.5}}]});
  const image=label=>{const canvas=document.createElement('canvas');canvas.width=240;canvas.height=70;const context=canvas.getContext('2d');context.fillStyle='#eef4ff';context.fillRect(0,0,240,70);context.fillStyle='#162c49';context.font='16px sans-serif';context.fillText(label,30,40);return {data:canvas.toDataURL('image/png').split(',')[1],width:240,height:70};};
  async function api(method,args){
    if(method==='stopAgent'){stopped.current=true;return {};}
    if(method!=='computer')throw Error('fixture_method');
    if(args.method==='artifact')return {before:image('출발 항목'),destinationBefore:image('도착 위치')};
    if(args.method==='decide'){
      if(args.decision==='reject'){setState(s=>({...s,actions:s.actions.map(a=>({...a,state:'rejected'}))}));return {};}
      if(args.pointerConsent!==true)throw Error('computer_pointer_consent_required');
      setCount(c=>c+1);setState(s=>({...s,actions:s.actions.map(a=>({...a,state:'starting'}))}));
      await new Promise(r=>setTimeout(r,1200));
      setState(s=>({...s,actions:s.actions.map(a=>({...a,state:stopped.current?'attention':'observed',verification:'not_verified',execution:'command_returned'}))}));return {};
    }
    throw Error('fixture_method');
  }
  return <main className="nubi-workbench"><p>실제 마우스 입력이 없는 승인 화면 검증입니다.</p><output aria-label="마우스 실행 횟수">{count}</output><ComputerUse taskId="pointer-fixture" state={state} api={api} refresh={async()=>{}}/></main>;
}

export function ComputerControlUiFixture(){
  const base={taskId:'controls-fixture',target:{element:{name:'알림 설정',type:'CheckBox'}},identity:{windowTitle:'합성 업무 앱',processName:'Fixture'},reason:'요청한 설정을 확인합니다.',documentEvidence:{id:'analysis-fixture',status:'partial',sources:[{path:'docs/앱-규칙.md',hash:'fixture',characters:18000}],resultHash:'result',advisory:true},wikiEvidence:[{evidenceId:'wiki-fixture',path:'openwiki/notification.md',start:3,freshness:'source_matched'}]};
  const actions=[{...base,id:'matched',action:'toggle_on',state:'observed',verification:'state_matched',execution:'already_at_target'},{...base,id:'stale',action:'select',state:'stale',error:'wiki_evidence_stale'}];
  const field=(index,action,name,more={})=>({index,action,selector:'field-'+index,target:{element:{name,type:'Edit'}},...more});
  actions.push({taskId:'controls-fixture',id:'batch-waiting',fingerprint:'fixture',action:'batch',state:'proposed',reason:'요청한 입력 세 가지를 한 번에 실행합니다.',identity:base.identity,steps:[field(1,'set_value','메모',{value:'출장 택시비'}),field(2,'toggle_on','긴급 처리'),field(3,'invoke','임시 저장')]},
    {taskId:'controls-fixture',id:'batch-partial',fingerprint:'fixture',action:'batch',state:'observed',verification:'steps_partial',stopped:{step:2,reason:'computer_target_changed'},reason:'두 칸을 입력합니다.',identity:base.identity,steps:[field(1,'set_value','금액',{value:'45000',execution:'command_returned',verification:'value_matched'}),field(2,'set_value','메모',{value:'택시비',execution:'not_started',verification:'not_verified'})]});
  return <main className="nubi-workbench"><p>설정 상태와 Wiki 근거 표시의 합성 검증입니다.</p><ComputerUse taskId="controls-fixture" state={{availability:{available:false},apps:[],actions,checks:[]}} api={async()=>{throw Error('Read-only fixture');}} refresh={async()=>{}}/></main>;
}

export function ComputerUiFixture(){
  const [state,setState]=useState({availability:{available:true},apps:[],actions:[],checks:[]}),[count,setCount]=useState(0);
  async function api(method,args={}){
    if(method==='chooseComputerApp')return {cancelled:true};
    if(method!=='computer')throw Error('unexpected fixture method');
    if(args.method==='register_app')setState(s=>({...s,apps:[...s.apps,{id:'app-'+s.apps.length,taskId:'native-fixture',name:args.file.split('\\').at(-1),path:args.file}]}));
    if(args.method==='remove_app')setState(s=>({...s,apps:s.apps.filter(v=>v.id!==args.appId)}));
    if(args.method==='propose_launch')setState(s=>({...s,actions:[...s.actions,{id:'launch-'+s.actions.length,taskId:'native-fixture',action:'launch',state:'proposed',app:s.apps.find(v=>v.id===args.appId),reason:'합성 UI 실행 제안',fingerprint:'fixture'}]}));
    if(args.method==='decide'){
      const a=state.actions.find(v=>v.id===args.id);if(a.state==='proposed'&&args.decision==='approve')setCount(v=>v+1);
      setState(s=>({...s,actions:s.actions.map(v=>v.id!==args.id?v:{...v,state:args.decision==='reject'?'rejected':args.decision==='acknowledge'?'acknowledged':v.app.name.includes('unknown')?'attention':'observed',verification:args.decision==='approve'?(v.app.name.includes('unknown')?'window_not_observed':'window_observed'):'not_verified',pid:77,windows:args.decision==='approve'&&!v.app.name.includes('unknown')?[{hwnd:100,title:'실행한 앱',identity:{hwnd:100,processId:77}}]:[]})}));
    }
    if(args.method==='bind')setState(s=>({...s,binding:{taskId:'native-fixture',processName:'합성 앱',windowTitle:'실행한 앱'}}));
    if(args.method==='review_result')setState(s=>({...s,actions:s.actions.map(v=>v.id===args.id?{...v,review:{state:'finished'}}:v)}));
    if(args.method==='refresh_launch')return {};
    return {};
  }
  return <main className="nubi-workbench"><p>Windows 앱 실행 화면의 합성 검증입니다.</p><output aria-label="실행 횟수">{count}</output><ComputerUse taskId="native-fixture" state={state} api={api} refresh={async()=>{}}/></main>;
}
