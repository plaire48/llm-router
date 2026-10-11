// A scripted OpenAI-compatible model for Electron checks (2026-10-07). It serves the streaming chat endpoint the worker's
// "compatible" provider speaks, answers the host's own envelopes (work planner, independent review, summaries) with valid
// JSON, and leaves the main-model turns to the check's `respond`. Every request is recorded for the report. `setFailing`
// makes the server answer 500 so a check can watch the app fail and recover. No real provider, login or network.
import {createServer} from 'node:http';
const USAGE={prompt_tokens:120,completion_tokens:12,total_tokens:132};
export async function startFixtureModel({respond,planSkill,token='fixture-token',model='fixture-model'}){
  const requests=[],calls=[],reviewProblems=[],planned=[];let failing=false;
  const chunk=(delta,finish=null,withUsage)=>({id:'fixture',object:'chat.completion.chunk',model,choices:[{index:0,delta,finish_reason:finish}],...(withUsage?{usage:USAGE}:{})});
  const text=content=>[chunk({role:'assistant',content:''}),chunk({content}),chunk({},'stop',true)];
  const call=(name,args)=>{calls.push(name);return [chunk({role:'assistant',tool_calls:[{index:0,id:'call_'+calls.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}),chunk({},'tool_calls',true)];};
  const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
  function decide(body){
    const messages=body.messages||[],first=String(messages[0]?.content||''),tools=(body.tools||[]).map(tool=>tool.function?.name);
    requests.push({system:first.slice(0,48),last:messages.at(-1)?.role,tools:tools.length});
    if(first.startsWith("You are Nubi Desktop's work planner")){/* the host plans before the first tool runs; a plan may name a skill the catalog offers */
      const offered=planSkill?parse(messages[1]?.content).capabilities?.skills?.find(item=>item.name===planSkill):null;planned.push(!!offered);
      return text(JSON.stringify({intent:{goal:'요청대로 처리한다',constraints:[],outcomes:['요청한 결과'],workflowIds:[],skillPaths:offered?[offered.path]:[]},explanation:'검사용 계획',steps:[{text:'자료를 확인한다',expected_outcome:'필요한 자료를 읽는다',status:'in_progress'},{text:'요청을 끝낸다',expected_outcome:'결과를 전한다',status:'pending'}]}));
    }
    if(first.startsWith('Nubi Desktop independent result review')){/* a verdict for every requirement with observed evidence; a tool envelope on the retry */
      const retry=first.indexOf('Problems found:');if(retry>=0)reviewProblems.push(first.slice(retry,retry+300));
      const data=parse(messages[1]?.content),evidenceIds=(data.evidence||[]).filter(item=>item.usable).map(item=>item.id).slice(0,16);
      const verdict={status:'ready',nextStep:'',checks:(data.requirements||[{id:'request'}]).map(item=>({requirementId:item.id,state:'supported',evidenceIds,detail:'관찰한 결과와 근거가 요구사항을 뒷받침한다.'}))};
      return tools.includes('report_desktop_review')?call('report_desktop_review',verdict):text(JSON.stringify(verdict));
    }
    if(first.startsWith('Summarize conversation'))return text(JSON.stringify({goal:'검사',constraints:[],decisions:[],completed:[],pending:[],references:[]}));
    const results=messages.filter(message=>message.role==='tool').map(message=>parse(message.content));
    const user=messages.filter(message=>message.role==='user').map(message=>String(message.content||''));
    return respond({messages,results,user,tools,calls,text,call})||text('검사 응답입니다.');
  }
  const server=createServer((request,response)=>{
    if(request.method!=='POST'||!request.url.endsWith('/chat/completions')){response.writeHead(404).end();return;}
    if(request.headers.authorization!==`Bearer ${token}`){response.writeHead(401).end();return;}
    let raw='';request.on('data',part=>{raw+=part;});request.on('end',()=>{
      if(failing){response.writeHead(500,{'Content-Type':'application/json'});response.end('{"error":{"message":"fixture model down"}}');return;}
      let body;try{body=JSON.parse(raw);}catch{response.writeHead(400).end();return;}
      response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
      for(const frame of decide(body))response.write('data: '+JSON.stringify(frame)+'\n\n');
      response.write('data: [DONE]\n\n');response.end();
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  return {port,token,model,connection:{provider:'compatible',baseUrl:`http://127.0.0.1:${port}/v1`,token,model},requests,calls,reviewProblems,planned,setFailing(value){failing=value;},close(){server.close();}};
}
