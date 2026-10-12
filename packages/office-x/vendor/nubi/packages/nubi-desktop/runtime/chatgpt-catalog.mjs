// Account catalog contract verified against openai/codex models_endpoint.rs.
// Keep Pi's transport identity. Credentials stay inside the owned worker.
import {chatGPTModels} from '../../../extensions/aipro-chat/chatgpt-api.js';
import {httpError,windowTokens} from '../../../extensions/aipro-chat/core.js';
const positive=value=>{
 const parsed=typeof value==='string'&&/^\d{1,8}$/.test(value.trim())?Number(value):value;
 return Number.isSafeInteger(parsed)&&parsed>0?parsed:undefined;
};
export async function desktopChatGPTModels({credential,fetchImpl=fetch,signal=AbortSignal.timeout(20000)}={}) {
 if(!credential?.token)throw Error('no_credential');
 let account;try{const encoded=credential.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');account=JSON.parse(atob(encoded))['https://api.openai.com/auth']?.chatgpt_account_id;}catch{throw Error('chatgpt_token_invalid');}
 if(typeof account!=='string'||!account||/[\r\n]/.test(account))throw Error('chatgpt_token_invalid');
 const response=await fetchImpl('https://chatgpt.com/backend-api/codex/models?client_version=1.1.1',{headers:{Authorization:`Bearer ${credential.token}`,'ChatGPT-Account-ID':account,originator:'pi',Accept:'application/json'},signal,credentials:'omit',redirect:'error',cache:'no-store'});
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw Object.assign(Error(httpError(response.status)),{status:response.status});}
 if(Number(response.headers.get('content-length'))>1024*1024)throw Error('models_invalid');
 const reader=response.body?.getReader();if(!reader)throw Error('models_invalid');let bytes=0,parts=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1024*1024)throw Error('models_invalid');parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 let payload;try{payload=JSON.parse(Buffer.concat(parts).toString());}catch{throw Error('models_invalid');}
 if(!Array.isArray(payload?.models)||payload.models.length>500)throw Error('models_invalid');
 const supported=new Map(chatGPTModels().payload.modelList.map(model=>[model.name,model]));
 const modelList=payload.models.filter(m=>m&&typeof m.slug==='string'&&/^[a-zA-Z0-9._-]{1,160}$/.test(m.slug)&&(!m.visibility||m.visibility==='list')).map((m,index)=>{
 const fallback=supported.get(m.slug),accountContext=windowTokens(m),context=accountContext||windowTokens(fallback);
 const maximum=positive(m.max_context_window)||positive(m.max_context_length);
 const maxContext=maximum&&(!context||maximum>=context)?maximum:undefined;
 const maxInput=positive(m.max_input_tokens)||positive(fallback?.max_input_tokens);
 const maxOutput=positive(m.max_output_tokens)||positive(m.max_completion_tokens)||positive(fallback?.max_output_tokens);
 const effortIds=new Set(['none','minimal','low','medium','high','xhigh','max']);
 const reported=Array.isArray(m.supported_reasoning_levels)?m.supported_reasoning_levels: fallback?.supported_reasoning_levels;
 const efforts=Array.isArray(reported)?[...new Set(reported.map(item=>typeof item==='string'?item:item?.effort).filter(item=>effortIds.has(item)))]:undefined;
 const defaultEffort=effortIds.has(m.default_reasoning_level)?m.default_reasoning_level:undefined;
 return {name:m.slug,display_name:typeof m.display_name==='string'?m.display_name.slice(0,160):m.slug,sort_seq:index,...(efforts?{supported_reasoning_levels:efforts}:{}),...(defaultEffort?{default_reasoning_level:defaultEffort}:{}),...(context?{context_length:context,context_source:accountContext?'account':'bundled'}:{}),...(maxContext?{max_context_length:maxContext}:{}),...(maxInput?{max_input_tokens:maxInput}:{}),...(maxOutput?{max_output_tokens:maxOutput}:{}),supports_images:Array.isArray(m.input_modalities)?m.input_modalities.includes('image'):fallback?.supports_images===true};
 });
 if(!modelList.length)throw Error('models_invalid');
 return {status:response.status,payload:{modelList},source:'account',fetchedAt:Date.now()};
}
