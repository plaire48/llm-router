import React,{useEffect,useRef,useState} from 'react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import {TerminalMark} from '../ui/marks.jsx';
import '@xterm/xterm/css/xterm.css';
const request=async args=>{const result=await window.nubi.terminal(args);if(result?.__nubiError)throw Error(result.__nubiError);return result;};
function transcript(view){const buffer=view?.buffer.active;if(!buffer)return '';const lines=[];for(let i=0;i<buffer.length;i++)lines.push(buffer.getLine(i)?.translateToString(true)||'');return lines.join('\n').trimEnd();}
export default function TerminalPanel({sessionId,project,cwd,profileId,onError,visible=true}){
 const node=useRef(null),terminal=useRef(null),fit=useRef(null),errors=useRef(onError),shown=useRef(visible),ready=useRef(false);
 errors.current=onError;shown.current=visible;
 const [state,setState]=useState('opening'),[selected,setSelected]=useState(false);
 const profile=project.profiles.find(item=>item.id===profileId);
 useEffect(()=>{
  let alive=true,frame=0,lastSize='',attached=false;const queued=[];
  const scope={id:sessionId,projectId:project.projectId};
  const style=getComputedStyle(node.current),color=name=>style.getPropertyValue(name).trim();
  const view=new Terminal({cursorBlink:true,cursorStyle:'bar',scrollback:3000,fontFamily:style.getPropertyValue('--nubi-code-family').trim()||style.fontFamily,fontSize:parseFloat(style.fontSize),theme:{background:color('--nubi-terminal-surface'),foreground:color('--nubi-terminal-ink'),cursor:color('--nubi-terminal-accent'),selectionBackground:color('--nubi-terminal-selection')}});
  const addon=new FitAddon();view.loadAddon(addon);view.open(node.current);view.textarea?.setAttribute('aria-label',`${profile?.label||'셸'} 터미널 입력`);terminal.current=view;fit.current=addon;
  const send=(action,args={})=>request({...scope,action,...args});
  const write=(data,ack=false)=>view.write(data,()=>{if(alive&&ack)void send('ack',{length:data.length}).catch(()=>{});});
  const receive=event=>{
   if(!alive||event.id!==sessionId)return;
   if(!attached){queued.push(event);return;}
   if(event.type==='data')write(event.data,true);
   else{ready.current=false;setState(event.type==='exit'?'exited':'disconnected');view.writeln(event.type==='exit'?`\r\n[셸 종료 ${event.exitCode}]`:'\r\n[터미널 연결이 끊겼어요.]');}
  };
  const unsubscribe=window.nubi.onTerminalEvent(receive);
  const resize=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;const rect=node.current?.getBoundingClientRect();if(!rect?.width||!rect.height){lastSize='';return;}const key=`${rect.width}:${rect.height}`;if(key===lastSize)return;lastSize=key;addon.fit();if(ready.current)void send('resize',{cols:view.cols,rows:view.rows}).catch(()=>{});});};
  const observer=new ResizeObserver(resize);observer.observe(node.current);resize();
  const input=view.onData(data=>{if(!ready.current)return;void send('input',{data}).catch(error=>{if(alive){ready.current=false;setState('disconnected');errors.current(error);}});});
  const selection=view.onSelectionChange(()=>setSelected(view.hasSelection()));
  view.attachCustomKeyEventHandler(event=>{
   if(event.type!=='keydown')return true;
   // Let app tab shortcuts through; Escape belongs to the running shell.
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='w')return false;
   if(event.key==='Escape')event.stopPropagation();
   if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='c'){if(view.hasSelection()){void navigator.clipboard.writeText(view.getSelection());event.preventDefault();return false;}}
   return true;
  });
  void send('open',{profile:profileId,path:cwd,cols:view.cols,rows:view.rows}).then(result=>{
   if(!alive){void send('detach').catch(()=>{});return;}
   // Startup events are already in the host replay. Only events following this reply are live.
   queued.length=0;attached=true;ready.current=result.state==='running';setState(result.state);write(result.output||'');
   addon.fit();void send('resize',{cols:view.cols,rows:view.rows}).catch(()=>{});if(shown.current)view.focus();
  }).catch(error=>{if(alive){attached=true;setState('failed');errors.current(error);}});
  return()=>{alive=false;ready.current=false;cancelAnimationFrame(frame);observer.disconnect();unsubscribe();input.dispose();selection.dispose();view.dispose();terminal.current=null;void send('detach').catch(()=>{});};
 },[sessionId,project.projectId]);
 useEffect(()=>{if(visible){fit.current?.fit();terminal.current?.focus();}},[visible]);
 return <section className="desktop-terminal" hidden={!visible} aria-label="프로젝트 터미널" data-terminal-state={state}>
  <div className="desktop-terminal-heading"><TerminalMark size={16}/><strong>{profile?.label||'터미널'}</strong><span title={cwd||project.root}>{cwd||project.root}</span><div className="desktop-terminal-copy-actions">{selected&&<CopyButton getText={()=>terminal.current?.getSelection()||''} label="선택한 내용 복사" successMessage="선택한 내용을 복사했습니다."/>}<CopyButton getText={()=>transcript(terminal.current)} label="터미널 내용 복사" successMessage="터미널 내용을 복사했습니다."/></div><CxButton aria-label="터미널 출력 지우기" title="출력 지우기" onClick={()=>{terminal.current?.clear();terminal.current?.focus();}}><Icon name="filterClear" size={16}/></CxButton></div>
  <div ref={node} className="desktop-terminal-output"/>
  {state==='opening'&&<div className="desktop-terminal-recovery" role="status">터미널 여는 중</div>}
  {['failed','disconnected'].includes(state)&&<div className="desktop-terminal-recovery" role="status">터미널을 다시 열어 주세요.</div>}
 </section>;
}
