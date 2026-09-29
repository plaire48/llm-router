import {readCompletion} from '../completion-reader.js';
import {ORIGIN} from '../core.js';

// Validate real response envelopes with the same parser as the product. Keep
// only counts; response text, tool arguments and credentials are not persisted.
export async function hasModelOutput({status,contentType,body}) {
  if(status!==200 || !body || body.length>8*1024*1024)return false;
  try {
    await readCompletion(new Response(body,{status,headers:{'content-type':contentType || ''}}),
      undefined,undefined,undefined,undefined,()=>{});
    return true;
  } catch {return false;}
}
export function isEvaluationRequest(request,model) {
  try {
    const url=new URL(request.url());
    return url.origin===ORIGIN && url.pathname==='/api/v1/chat/completions' &&
      request.method()==='POST' && request.postDataJSON()?.model===model;
  } catch {return false;}
}
export function trackModelEvidence(context,model) {
  const requests=new Set(),pending=new Set();
  let received=0,unverified=0,stopped=false;
  const onRequest=request=>{if(isEvaluationRequest(request,model))requests.add(request);};
  const onResponse=response=>{
    if(!requests.has(response.request()))return;
    const check=(async()=>{
      let timer;
      try {
        const valid=await Promise.race([
          (async()=>hasModelOutput({status:response.status(),contentType:response.headers()['content-type'],body:await response.body()}))(),
          new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);}),
        ]);
        if(valid)received++;else unverified++;
      } catch {unverified++;} finally {clearTimeout(timer);}
    })();
    pending.add(check);check.finally(()=>pending.delete(check));
  };
  context.on('request',onRequest);context.on('response',onResponse);
  return {
    get requests(){return requests.size;},
    async finish(){
      if(!stopped){stopped=true;context.off('request',onRequest);context.off('response',onResponse);}
      await Promise.all([...pending]);
      return {modelRequests:requests.size,modelResponses:received,unverifiedResponses:unverified};
    },
  };
}
