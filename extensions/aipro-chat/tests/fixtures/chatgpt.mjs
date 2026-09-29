export const chatgptToken = () => `header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600,'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-account'}})).toString('base64url')}.signature`;
export function responsesSSE({text='ChatGPT 합성 응답입니다.',tool,usage={input_tokens:120,output_tokens:20,input_tokens_details:{cached_tokens:40}},status='completed'}={}) {
  const item=tool?{type:'function_call',id:'fc_synthetic',call_id:'call_synthetic',name:tool.name,arguments:JSON.stringify(tool.arguments),status:'completed'}:{type:'message',id:'msg_synthetic',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
  const events=[{type:'response.created',response:{id:'resp_synthetic'}},{type:'response.output_item.added',output_index:0,item:{...item,...(tool?{arguments:''}:{content:[]})}}];
  if (tool) events.push({type:'response.function_call_arguments.delta',output_index:0,delta:item.arguments});
  else events.push({type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:text});
  events.push({type:'response.output_item.done',output_index:0,item},{type:status==='completed'?'response.completed':'response.incomplete',response:{id:'resp_synthetic',status,output:[item],usage,...(status==='incomplete'?{incomplete_details:{reason:'max_output_tokens'}}:{})}});
  return events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}
