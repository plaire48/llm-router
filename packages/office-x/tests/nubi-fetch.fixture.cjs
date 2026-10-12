// Test-only network boundary; this file is never shipped with the worker.
let turn=0;
global.fetch=async(url,options={})=>{
  if(String(url).endsWith('/api/models'))return Response.json({modelList:[{name:'fixture-a',context_length:262144}]});
  if(String(url).includes('chat/completions')){
    const body=JSON.parse(options.body);if(body.model!=='fixture-a')throw Error('unexpected_model');
    if(turn===2&&!body.messages.some(m=>m.role==='user'&&m.content.includes('첫 질문')))throw Error('history_missing');
    const tool=turn++===0;const delta=tool?{tool_calls:[{index:0,id:'read-fixture',type:'function',function:{name:'read_selection',arguments:'{}'}}]}:{content:'선택한 범위를 확인했습니다.'};
    return new Response(`data: ${JSON.stringify({choices:[{delta}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:25,completion_tokens:6}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  }
  throw Error('unexpected_network');
};
