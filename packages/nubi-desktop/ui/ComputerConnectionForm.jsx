import React,{useState} from 'react';
import {CxButton, CxNotice} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {QuestionForm} from '../../../extensions/aipro-chat/src/QuestionForm.jsx';

const connectionErrors={computer_unavailable:'Windows 실행기 연결이 필요해요.',computer_command_failed:'열린 창을 찾지 못했어요. 앱이 열려 있는지 확인하고 다시 찾아 주세요.',computer_target_changed:'창이 바뀌었어요. 열린 앱을 다시 찾아 선택해 주세요.',computer_connection_changed:'연결 요청이 바뀌었어요. 현재 요청을 다시 확인해 주세요.',computer_app_changed:'실행 파일이 바뀌었어요. 앱 파일을 다시 선택해 주세요.',computer_busy:'앱 작업이 진행 중이에요. 끝난 뒤 다시 선택해 주세요.'};

// Selection and free text share the Nubi question surface. Text never binds an app.
export function ComputerConnectionForm({taskId,request,state,api,refresh,disabled}){
  const [windows,setWindows]=useState(null),[registered,setRegistered]=useState(false),[limit,setLimit]=useState(4),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const binding=state?.binding?.taskId===taskId?state.binding:null;
  const connected=request.state==='connected'&&binding&&windows===null&&!registered;
  const options=connected?[{id:'continue',label:'연결한 앱으로 이어가기',description:binding.windowTitle},{id:'windows',label:'다른 앱 선택'}]:registered?[{id:'registered',label:'등록한 앱으로 진행'},{id:'windows',label:'열린 앱 선택'}]:windows?.length?windows.slice(0,limit).map((window,index)=>({id:'window-'+index,label:window.title||window.processName,description:window.processName})):[{id:'windows',label:windows?'열린 앱 다시 찾기':'열린 앱 선택'},{id:'file',label:'앱 파일 선택',description:'실행 파일을 등록한 뒤 실행을 준비합니다'}];
  async function choose(choice){
    setError('');setBusy(true);
    const method=choice.optionId;
    try{
      if(choice.text!==undefined)await api('computer',{method:'answer_connection',taskId,requestId:request.id,text:choice.text});
      else if(method==='windows'){const result=await api('computer',{method:'windows',taskId});setWindows(result.windows);setLimit(4);setRegistered(false);}
      else if(method==='file'){const result=await api('chooseComputerApp',{taskId});if(!result.cancelled)setRegistered(true);}
      else if(method==='registered')await api('computer',{method:'answer_connection',taskId,requestId:request.id,text:'이 작업에 등록한 앱의 실행을 준비해 주세요.'});
      else if(method==='continue')await api('computer',{method:'continue_connection',taskId,requestId:request.id});
      else {const selected=windows?.[Number(method?.replace('window-',''))];if(!selected)throw Error('computer_connection_changed');await api('computer',{method:'bind',taskId,requestId:request.id,window:selected.hwnd,expectedIdentity:selected.identity});setWindows(null);}
      await refresh();return true;
    }finally{setBusy(false);}
  }
  async function cancel(){if(busy)return;setBusy(true);try{await api('computer',{method:'cancel_connection',taskId,requestId:request.id});await refresh();}catch{setError('취소하지 못했어요. 다시 시도해 주세요.');}finally{setBusy(false);}}
  return <div className="nubi-connection-question" role="region" aria-label="확인할 앱 연결">
    <QuestionForm question={{id:request.id,text:connected?'이 앱으로 이어갈까요?':registered?'등록한 앱으로 진행할까요?':windows?.length?'어느 창에 연결할까요?':'어떤 앱을 확인할까요?',kind:'choice',options,draft:request.draft||'',inputPlaceholder:'앱 이름과 필요한 내용을 적어 주세요.'}} headingAction={<ActionButton action="close" label="연결 취소" title="연결 취소" disabled={disabled||busy} onClick={cancel}/>} disabled={disabled||busy} formatError={cause=>connectionErrors[cause?.message]||'요청을 처리하지 못했어요. 입력은 유지했습니다. 다시 확인해 주세요.'} onChoose={choose} onDraft={draft=>api('computer',{method:'save_connection_draft',taskId,requestId:request.id,draft})}>
      {({disabled:blocked})=><>
        {!connected&&<p className="nubi-muted">{request.reason}</p>}
        {windows?.length===0&&<p className="nubi-muted">열린 창을 찾지 못했어요. 앱을 연 뒤 다시 찾아 주세요.</p>}
        {windows?.length>limit&&<ActionButton action="expand" label="다른 창 더 보기" disabled={blocked} onClick={()=>setLimit(value=>value+4)}/>}
        {windows!==null&&<CxButton type="button" disabled={blocked} onClick={()=>{setWindows(null);setLimit(4);}}>다른 방법으로 선택</CxButton>}
        <p className="nubi-muted">연결한 창의 내용과 이미지를 모델이 읽습니다. 조작은 별도로 승인합니다.</p>
      </>}
    </QuestionForm>
    {error&&<CxNotice tone="danger">{error}</CxNotice>}
  </div>;
}
