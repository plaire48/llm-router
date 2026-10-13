// Test-only provider. The worker must send no document tools while summarizing.
let compacted=false;
global.fetch=async(url,options={})=>{
 if(String(url).endsWith('/api/models'))return Response.json({modelList:[{name:'fixture-a',context_length:262144}]});
 if(!String(url).includes('chat/completions'))throw Error('unexpected_network');
 const body=JSON.parse(options.body),system=body.messages.find(m=>m.role==='system')?.content||'';
 const summary=/Summarize this Office Agent conversation/.test(system);
 if(summary&&body.tools?.length)throw Error('summary_has_tools');
 if(!summary&&body.tools?.some(t=>/web_search|read_web_page/.test(t.function.name)))throw Error('search_registered');
 if(!summary&&compacted&&!body.messages.some(m=>String(m.content).includes('과거 기록')))throw Error('summary_missing_from_followup');
 if(summary)compacted=true;
 const content=summary?'첫 요청의 목적과 검증 필요 사항을 유지합니다. 현재 문서를 다시 확인합니다.':'요청 문맥을 확인했습니다. '+ '이전 요청의 목적을 유지합니다. '.repeat(30);
 return new Response(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1000,completion_tokens:200}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
};
