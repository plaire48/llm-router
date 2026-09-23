// Synthetic UI states. No Windows programs are started by this fixture.
import React,{useState} from 'react';
import {ComputerUse} from '../ui/ComputerUse.jsx';

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
