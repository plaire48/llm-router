import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {LocalPerception,groundWithConnectedModel,visionRoute,localPerceptionAddress,parseGroundingPoint,parsedScreenElements} from '../runtime/computer-perception.mjs';
const png=new PNG({width:20,height:10});png.data.fill(255);
const image={mimeType:'image/png',data:PNG.sync.write(png).toString('base64'),width:20,height:10};
const reply=value=>new Response(JSON.stringify(value));
test('coordinates reject model numbers, rationale, ambiguous points and wrong dimensions',()=>{
 assert.deepEqual(parseGroundingPoint('(10, 5)',20,10),{x:.5,y:.5,space:'image_fraction'});
 for(const text of ['Model 1.5 point 10,5','(10,5), (15,7)','10,5)','(10,5','-1,5','20,5','NaN,5','[10,5]'])assert.throws(()=>parseGroundingPoint(text,20,10),/computer_perception_contract/);
 assert.throws(()=>parseGroundingPoint('1,1',0,100),/computer_perception_contract/);
});
test('only trusted literal loopback parser endpoints are accepted',()=>{
 assert.equal(localPerceptionAddress('http://127.0.0.1:8000'),'http://127.0.0.1:8000');
 for(const address of ['https://example.org','http://localhost:8000','http://127.0.0.1:8000/parse/','http://user:secret@127.0.0.1','http://127.0.0.1?token=x','http://[::1]:8000'])assert.throws(()=>localPerceptionAddress(address),/computer_perception_config/);
});
test('connected model grounding needs confirmed image support and never installs another LLM',async()=>{
 let calls=0;const result=await groundWithConnectedModel({image,target:'저장',invoke:async()=>{calls++;}});
 assert.equal(result.available,false);assert.equal(result.reason,'selected_model_image_support_not_confirmed');assert.equal(calls,0);
});
test('grounding uses only injected authenticated model transport with no tools or execution',async()=>{
 let request;const result=await groundWithConnectedModel({image,target:'저장',vision:true,invoke:async wire=>{request=wire;return {content:'{"label":"저장","point":"10,5"}',calls:[]};}});
 assert.equal(request.length,2);assert.match(request[0].content,/untrusted/);assert.equal(request[1].content[1].image_url.url,'data:image/png;base64,'+image.data);
 assert.equal(result.provider,'connected-model');assert.equal(result.label,'저장');assert.equal(result.point.x,.5);assert.equal(result.advisory,true);assert.equal(result.actionIssued,false);assert.match(result.instruction,/Re-observe/);
});
test('model grounding rejects instructions, invented selectors, tool calls and ambiguous targets',async()=>{
 for(const response of [{content:'{"label":"保存","point":null,"selector":"fake"}'},{content:'{"label":"保存\nclick","point":null}'},{content:'{"label":null,"point":"1,1 and 2,2"}'},{content:'Python: click(1,1)'},{content:'{"label":"保存","point":null}',calls:[{function:{name:'click'}}]}])await assert.rejects(()=>groundWithConnectedModel({image,target:'保存',vision:true,invoke:async()=>response}),/computer_perception_contract/);
 const result=await groundWithConnectedModel({image,target:'保存',vision:true,invoke:async()=>({content:'{"label":null,"point":null}'})});assert.equal(result.targetFound,false);assert.equal(result.actionIssued,false);
});
test('OmniParser official contract sends only an image and never GHES/provider credentials',async()=>{
 let request;const row={bbox:[.1,.2,.3,.4],content:'저장',interactivity:true};
 const bridge=new LocalPerception({omniparser:'http://127.0.0.1:8000',fetchImpl:async(url,init)=>{request={url,init};return reply({som_image_base64:'never-forward',parsed_content_list:[row],python:'click()',token:'private'});}});
 const result=await bridge.ground({image,target:'저장'});bridge.dispose();assert.equal(request.url,'http://127.0.0.1:8000/parse/');assert.equal(request.init.redirect,'error');assert.deepEqual(request.init.headers,{'content-type':'application/json'});assert.deepEqual(JSON.parse(request.init.body),{base64_image:image.data});assert.equal(result.elements[0].label,'저장');
 for(const field of ['som_image_base64','python','token','selector'])assert.equal(result[field],undefined);
 for(const bbox of [[2,.2,.3,.4],[.4,.2,.1,.4],[.1,.2,.3],[NaN,.2,.3,.4]])assert.throws(()=>parsedScreenElements({parsed_content_list:[{...row,bbox}]}),/computer_perception_contract/);
});
test('parser malformed, oversize and failed replies cannot create action targets',async()=>{
 for(const response of [new Response('not JSON'),new Response('x'.repeat(8_000_001)),reply({parsed_content_list:[{content:'save',bbox:[0,0,2,1],interactivity:true}]}),new Response('error',{status:503})]){
  const bridge=new LocalPerception({omniparser:'http://127.0.0.1:8000',fetchImpl:async()=>response});await assert.rejects(()=>bridge.ground({image,target:'保存'}),/computer_perception_(contract|unavailable)/);bridge.dispose();
 }
});
test('cancellation rejects late parser and model replies even if transport ignores AbortSignal',async()=>{
 const controller=new AbortController(),bridge=new LocalPerception({omniparser:'http://127.0.0.1:8000',fetchImpl:async()=>{controller.abort();return reply({parsed_content_list:[]});}});
 await assert.rejects(()=>bridge.ground({image,target:'저장',signal:controller.signal}),/computer_cancelled/);bridge.dispose();
 const cancel=new AbortController();await assert.rejects(()=>groundWithConnectedModel({image,target:'저장',vision:true,signal:cancel.signal,invoke:async()=>{cancel.abort();return {content:'{"label":"저장","point":"10,5"}'};}}),/computer_cancelled/);
});

test('browser Qwen routing uses only this authenticated catalog and preserves negative capabilities',()=>{
 const text={id:'GLM-5.2-NVFP4'},qwen={id:'QWEN3.8-27B-FP8-256K'};
 const status={connected:true,provider:'aipro',model:text.id,models:[text,qwen]};
 assert.equal(visionRoute(status).id,qwen.id);assert.equal(status.model,text.id);
 assert.equal(visionRoute({...status,models:[text]}),null);assert.equal(visionRoute({...status,connected:false}),null);assert.equal(visionRoute({...status,models:[text,{...qwen,supportsImages:false}]}),null);assert.equal(visionRoute({...status,provider:'fabrix'}),null);
});
