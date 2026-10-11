import React from 'react';
import {createRoot} from 'react-dom/client';
import {KnowledgeMap} from '../ui/KnowledgeMap.jsx';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
window.dbCalls=[];window.dbFail=false;window.dbStatusFail=false;window.vocCalls=[];window.vocFail=false;window.formNotices=[];window.formErrors=[];
const connections=[];
async function api(method,args){
  if(method==='knowledgeMap')return {nodes:[],edges:[],diagnostics:[],configured:false};
  if(method==='databaseConnection'){
    if(args?.action){
      window.dbCalls.push(structuredClone(args));if(window.dbFail)throw Error('database_connection_failed');
      const found=connections.findIndex(c=>c.id===args.id);if(found>=0)connections.splice(found,1);
      const receipt={id:args.id,engine:args.input?.engine,tables:3,collectedAt:new Date().toISOString()};
      if(args.action!=='disconnect')connections.push(receipt);return receipt;
    }
    if(window.dbStatusFail)throw Error('status_unavailable');return {connections};
  }
  if(method==='importVoc'){window.vocCalls.push(method);return {noChange:false};}
  if(method==='queryVoc'){window.vocCalls.push(method);if(window.vocFail)throw Error('read_failed');return {results:[{id:'voc',key:'VOC-1',title:'보관한 자료',excerpt:'검증',path:'voc/one.md'}]};}

  throw Error('unexpected_fixture_call');
}
createRoot(document.getElementById('root')).render(<main className="nubi-workbench"><div className="deck-dialog nubi-panel">{<KnowledgeMap api={api} taskId="fixture" openPath={()=>{}} onError={()=>{}} onNotice={()=>{}}/>}</div></main>);
