import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GitHistory} from '../electron-app/GitHistory.jsx';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
window.historyCalls=[];
const commits=Array.from({length:53},(_,i)=>({id:(i+1).toString(16).padStart(40,'0'),subject:i===0?'메일 검색 조건과 커밋 이력의 가독성을 개선하고 프로젝트별 변경 사항을 확인하도록 수정':'프로젝트 문서와 사용자 흐름 개선 '+(i+1),author:i===0?'매우 긴 이름의 작성자 표시 검증':'김누비',date:'2026-10-12T09:24:00+09:00'}));
const api=async(method,args)=>{
  window.historyCalls.push({...args});await new Promise(resolve=>setTimeout(resolve,window.historyDelay||30));
  if(window.historyFailure)throw Error('fixture_read_failed');
  if(args.commit&&window.historyEmptyCommit)return {commit:{...commits.find(c=>c.id===args.commit),parents:[]},files:[],totalFiles:0};
  if(window.historyEmpty)return {commits:[],branches:[],currentBranch:'main',tip:null,limit:25,hasMore:false};
  if(args.commit)return {commit:{...commits.find(c=>c.id===args.commit),parents:[]},files:[{path:'src/example.js',status:'M',added:5,removed:2}],totalFiles:1};
  return {commits:commits.slice(args.offset||0,(args.offset||0)+25),branches:[{ref:'refs/heads/main',name:'main',tip:commits[0].id}],currentBranch:'refs/heads/main',tip:commits[0].id,limit:25,offset:args.offset||0,hasMore:(args.offset||0)+25<commits.length};
};
function Fixture(){const [open,setOpen]=useState(true);return <div className="desktop-shell" style={{height:'100vh'}}><button onClick={()=>setOpen(v=>!v)} aria-label="검증용 이력 토글" style={{position:'absolute',left:0,bottom:0,zIndex:9999}}>보기</button><div className="desktop-pane" style={{width:'100%',height:'100%',maxWidth:'none',border:0}}>{open&&<GitHistory api={api} projectId="fixture" onError={error=>{window.historyLastError=error.message;}}/>}</div></div>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
