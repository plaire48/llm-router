import React,{useEffect,useRef,useState} from 'react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {CxButton,CxInput,Icon} from '@e2e/cx-design-system';
import {TerminalMark,StopMark} from '../ui/marks.jsx';
import '@xterm/xterm/css/xterm.css';
const finishedStates=new Set(['completed','failed','cancelled','timed_out']);
export default function TerminalPanel({api,project,cwd,profileId,onDirectory,onError,onBusy,visible=true}) {
 const node=useRef(null),terminal=useRef(null),fit=useRef(null),output=useRef(''),running=useRef(null),launching=useRef(false),errors=useRef(onError),mounted=useRef(true),directory=useRef(onDirectory);
 errors.current=onError;directory.current=onDirectory;
 const [command,setCommand]=useState(''),[tracking,setTracking]=useState(null),[busy,setBusy]=useState(false),[recovering,setRecovering]=useState(false),[history,setHistory]=useState([]);const historyPosition=useRef(-1);
 const profile=project.profiles.find(item=>item.id===profileId);
 const busyCallback=useRef(onBusy);busyCallback.current=onBusy;
 function markBusy(value){busyCallback.current?.(value);setBusy(value);}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{const style=getComputedStyle(node.current),color=name=>style.getPropertyValue(name).trim();const view=new Terminal({disableStdin:true,convertEol:true,scrollback:3000,fontFamily:style.getPropertyValue('--nubi-code-family').trim()||style.fontFamily,fontSize:parseFloat(style.fontSize),theme:{background:color('--deck-card'),foreground:color('--deck-ink'),cursor:color('--deck-blue'),selectionBackground:color('--deck-blue-soft')}});const addon=new FitAddon();view.loadAddon(addon);view.open(node.current);terminal.current=view;fit.current=addon;const update=()=>{if(node.current?.getBoundingClientRect().width)addon.fit();};update();const observer=new ResizeObserver(update);observer.observe(node.current);return()=>{observer.disconnect();view.dispose();terminal.current=null;};},[]);
 useEffect(()=>{if(visible)fit.current?.fit();},[visible]);
 useEffect(()=>{
  if(!tracking)return;let alive=true,timer,failures=0;
  const read=async()=>{
   try{
    const record=await api('terminalCommand',{projectId:project.projectId,...tracking.id?{action:'poll',id:tracking.id}:{action:'receipt',requestId:tracking.requestId}});
    if(!alive)return;
    if(!finishedStates.has(record.state)&&!['running','checking','stopping'].includes(record.state)){failures++;setRecovering(true);return;}
    failures=0;setRecovering(false);
    const text=record.output||'';
    if(text.startsWith(output.current))terminal.current?.write(text.slice(output.current.length));
    else{terminal.current?.writeln('\r\n[출력 일부가 생략됐어요.]');terminal.current?.write(text);}
    output.current=text;
    if(finishedStates.has(record.state)){
     terminal.current?.writeln(`\r\n${record.state==='completed'?'종료':'실행 종료'} ${record.exitCode??record.state}`);
     if(record.execution==='not_started'&&record.fault)errors.current(new Error(record.fault));
     if(record.relative!==undefined)directory.current?.(record.relative);
     running.current=null;setTracking(null);busyCallback.current?.(false);setBusy(false);return;
    }
    if(record.id&&!tracking.id){running.current=record.id;setTracking({...tracking,id:record.id});return;}
   }catch{if(alive){failures++;setRecovering(true);}}
   finally{if(alive)timer=setTimeout(read,failures?Math.min(5000,500*2**Math.min(failures,4)):350);}
  };
  void read();return()=>{alive=false;clearTimeout(timer);};
 },[api,project.projectId,tracking]);
 async function execute(event){
  event.preventDefault();if(busy||launching.current||running.current||!command.trim())return;
  launching.current=true;const script=command,requestId=crypto.randomUUID();running.current=requestId;markBusy(true);setRecovering(false);output.current='';
  terminal.current?.writeln(`\r\n${cwd||'.'} ❯ ${script}`);
  try{
   const result=await api('terminalCommand',{projectId:project.projectId,path:cwd,script,profile:profileId,requestId});if(!mounted.current)return;
   setCommand('');setHistory(items=>[script,...items.filter(item=>item!==script)].slice(0,50));historyPosition.current=-1;
   if(result.id&&!finishedStates.has(result.state)){running.current=result.id;setTracking({requestId,id:result.id});}
   else{terminal.current?.write(result.output||'');if(result.exitCode!==0)terminal.current?.writeln(`\r\n종료 ${result.exitCode??result.state}`);running.current=null;markBusy(false);}
   if(result.relative!==undefined&&result.relative!==cwd)onDirectory(result.relative);
  }catch(error){
   if(!mounted.current)return;
   if(['project_changed','command_request_changed','terminal_request_limit'].includes(error.message)){running.current=null;markBusy(false);errors.current(error);}
   else{setRecovering(true);setTracking({requestId});}
  }finally{launching.current=false;}
 }
 return <section className="desktop-terminal" hidden={!visible} aria-label="프로젝트 터미널">
  <div className="desktop-terminal-heading"><TerminalMark size={16}/><strong>{profile?.label||'터미널'}</strong><span>{cwd||project.root}</span><CxButton aria-label="터미널 출력 지우기" title="출력 지우기" onClick={()=>terminal.current?.clear()}><Icon name="filterClear" size={15}/><span>지우기</span></CxButton>{tracking?.id&&<CxButton aria-label="실행 중지" title="실행 중지" onClick={()=>api('terminalCommand',{projectId:project.projectId,action:'stop',id:tracking.id}).catch(()=>setRecovering(true))}><StopMark size={15}/></CxButton>}</div>
  <div ref={node} className="desktop-terminal-output"/>
  {recovering&&<div className="desktop-terminal-recovery" role="status"><span className="status-spinner" aria-hidden="true"/><span>실행 상태를 다시 확인하고 있어요.</span></div>}
  <form className="desktop-terminal-input" onSubmit={execute}><span aria-hidden="true">❯</span><CxInput aria-label={`${profile?.label||'셸'} 명령`} placeholder="명령어 입력" disabled={busy} value={command} onChange={event=>setCommand(event.target.value)} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(['ArrowUp','ArrowDown'].includes(event.key)&&history.length){event.preventDefault();historyPosition.current=Math.max(-1,Math.min(history.length-1,historyPosition.current+(event.key==='ArrowUp'?1:-1)));setCommand(history[historyPosition.current]||'');}}}/><CxButton type="submit" disabled={busy||!command.trim()} aria-label="명령 실행" title="명령 실행"><Icon name="arrowRight" size={16}/><span>실행</span></CxButton></form>
 </section>;
}
