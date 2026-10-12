import React,{Suspense,lazy,useLayoutEffect,useRef,useState} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from '../ui/WorkspaceAction.jsx';
import {FolderMark} from '../ui/marks.jsx';
import {FileExplorer} from './FileExplorer.jsx';
const Editor=lazy(()=>import('./editor.jsx'));

export function FileWorkspace({api,project,buffer,revealRequest,cwd,onDirectory,onOpen,onSave,onReady,onError,visible,pinned,loading=false}) {
 const element=useRef(null),lastReveal=useRef(null),tabOpen=useRef(0),[compact,setCompact]=useState(false),[treeOpen,setTreeOpen]=useState(true);
 useLayoutEffect(()=>{const node=element.current;if(!node)return;const update=()=>{const width=node.getBoundingClientRect().width;if(width)setCompact(width<640);};update();const observer=new ResizeObserver(update);observer.observe(node);return()=>observer.disconnect();},[]);
 useLayoutEffect(()=>{
  if(!visible)return;
  if(revealRequest&&revealRequest.key===buffer?.key&&lastReveal.current!==revealRequest.id){lastReveal.current=revealRequest.id;setTreeOpen(true);return;}
  if(buffer&&pinned)setTreeOpen(false);
  else if(!pinned)setTreeOpen(true);
 },[buffer?.key,pinned,visible,revealRequest?.id]);
 const file= pinned ? buffer : null;
 const fileRoot=project.root,external=file?file.readOnly:/^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/])/.test(cwd||''),parts=external?[(file?.absolute||cwd).split(/[\\/]/).filter(Boolean).at(-1)].filter(Boolean):(file?.path||cwd||'').split('/').filter(Boolean),projectName=fileRoot.split(/[\\/]/).filter(Boolean).at(-1);
 function navigate(path){onDirectory(path);setTreeOpen(true);}
 async function openInTab(path){const request=++tabOpen.current,item=await onOpen(path);if(item&&request===tabOpen.current&&element.current&&!element.current.hidden)setTreeOpen(false);}
 return <section ref={element} className="desktop-file-workspace" hidden={!visible} data-compact={compact} data-editor={!!file||loading} data-tree-open={treeOpen} aria-label="프로젝트 파일 작업">
  <div className="desktop-file-location">
   <nav className="desktop-breadcrumbs" aria-label="현재 파일 경로">
    <CxButton title={fileRoot} onClick={()=>navigate('')}>{projectName}</CxButton>
    {parts.map((part,index)=><React.Fragment key={parts.slice(0,index+1).join('/')}><Icon name="chevronRight" size={12}/>{(external||file&&index===parts.length-1)?<span aria-current="page" title={file?.absolute||file?.path||cwd}>{part}</span>:<CxButton onClick={()=>navigate(parts.slice(0,index+1).join('/'))}>{part}</CxButton>}</React.Fragment>)}
   </nav>
   <div className="desktop-file-actions">{file?.readOnly&&<span className="desktop-readonly-label">읽기 전용</span>}
    {file?.model&&!file.readOnly&&<ActionButton action="save" iconOnly label="파일 저장" title="저장 (Ctrl+S)" disabled={!file.dirty} onClick={onSave}/>}
    <CxButton className="desktop-explorer-toggle" aria-label={treeOpen?'파일 탐색기 접기':'파일 탐색기 펼치기'} title={treeOpen?'파일 탐색기 접기':'파일 탐색기 펼치기'} aria-expanded={treeOpen} onClick={()=>setTreeOpen(value=>!value)}><FolderMark size={17}/><span>탐색기</span></CxButton>
   </div>
  </div>
  {(file||loading)&&<div className="desktop-file-content" aria-busy={loading}>
   {file?.preview?<div className="desktop-image-preview"><img src={file.preview} alt={file.path}/></div>:file?<Suspense fallback={<div className="desktop-file-loading" role="status"><span className="status-spinner" aria-hidden="true"/>편집기 준비 중</div>}><Editor buffer={file} onReady={onReady}/></Suspense>:<div className="desktop-file-loading" role="status"><span className="status-spinner" aria-hidden="true"/>파일 여는 중</div>}
  </div>}
  <FileExplorer key={`${project.projectId}:${buffer?.taskId||'root'}`} api={api} project={project} taskId={buffer?.taskId} selected={buffer?.absolute||buffer?.path} revealRequest={revealRequest} cwd={cwd} onDirectory={onDirectory} onOpen={openInTab} onError={onError} visible={visible&&treeOpen}/>
 </section>;
}
