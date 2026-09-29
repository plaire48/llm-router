import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkPlan,validateDatasetExport,DATASET_EXPORT_SHA256,benchmarkHarFilter,validateAgentInputs,freshBenchmarkSites,parseBenchmarkAnswer,validateBenchmarkHar} from '../scripts/webarena-runner.mjs';
const config={isolatedBenchmark:true,sites:{shopping_admin:{image:'am1n3e/webarena-verified-shopping_admin@sha256:'+'a'.repeat(64),port:17780,controlPort:17781,headers:{'X-M2-Admin-Auto-Login':'admin:fixture'}}}};
test('benchmark config accepts only pinned disposable official images and scoped login headers',()=>{
 const plan=benchmarkPlan(config);assert.equal(plan.environments.__SHOPPING_ADMIN__.urls[0],'http://127.0.0.1:17780/admin');
 for(const mutate of [c=>c.isolatedBenchmark=false,c=>c.sites.shopping_admin.image+=':latest',c=>c.sites.shopping_admin.controlPort=17780,c=>c.sites.shopping_admin.headers={Authorization:'private'}]){const c=structuredClone(config);mutate(c);assert.throws(()=>benchmarkPlan(c));}
 const filter=benchmarkHarFilter(plan.sites);assert(filter.test('http://127.0.0.1:17780/admin/orders'));assert(!filter.test('https://aipro.sdsdev.co.kr/api/models'));assert(!filter.test('http://127.0.0.1:177800/private'));assert(!filter.test('http://127.0.0.1:17781/status'));
 assert.throws(()=>validateBenchmarkHar({log:{entries:[{request:{url:'https://aipro.sdsdev.co.kr/private'}}]}},plan.sites));
});
test('agent export strips reference answers and rejects mismatched or external tasks',()=>{
 const plan=benchmarkPlan(config),input={task_id:108,sites:['shopping_admin'],start_urls:['http://127.0.0.1:17780/admin'],intent:'Read orders',expected_agent_response:'DO NOT FORWARD'};
 assert(!JSON.stringify(validateAgentInputs([input],[108],plan)).includes('DO NOT FORWARD'));
 assert.throws(()=>validateAgentInputs([input],[108,108],plan));assert.throws(()=>validateAgentInputs([{...input,start_urls:['https://personal.example']}],[108],plan));
 assert.equal(parseBenchmarkAnswer('```json\n{"task_type":"RETRIEVE","status":"SUCCESS","retrieved_data":[1],"error_details":null}\n```').status,'SUCCESS');assert.throws(()=>parseBenchmarkAnswer('Done'));
});
test('each trial creates new containers, checks initialization and deletes only owned IDs',async()=>{
 const calls=[],labels=new Map();let count=0;
 const run=async(file,args)=>{assert.equal(file,'docker');calls.push(args);if(args[0]==='run'){const id=(++count).toString(16).padStart(64,'0');labels.set(id,args[args.indexOf('--label')+1].split('=')[1]);return id;}if(args[0]==='inspect')return labels.get(args.at(-1));return '';};
 const request=async()=>new Response(JSON.stringify({success:true}));const plan=benchmarkPlan(config);
 const first=await freshBenchmarkSites(plan.sites,{run,request});const second=await freshBenchmarkSites(plan.sites,{run,request});assert.notEqual(first.receipts[0].containerId,second.receipts[0].containerId);
 assert(calls.filter(args=>args[0]==='run').every(args=>args.includes('--pull=never')&&!args.includes('-v')));
 await first.close();assert(calls.some(args=>args[0]==='rm'&&args.at(-1)===first.receipts[0].containerId));
 labels.set(second.receipts[0].containerId,'other-owner');await assert.rejects(second.close(),/ownership changed/);assert(!calls.some(args=>args[0]==='rm'&&args.at(-1)===second.receipts[0].containerId));
});
test('initialization failure retires the new owned container and never starts the browser',async()=>{
 const calls=[];let label;const run=async(_file,args)=>{calls.push(args);if(args[0]==='run'){label=args[args.indexOf('--label')+1].split('=')[1];return 'b'.repeat(64);}if(args[0]==='inspect')return label;return '';};
 const request=async url=>new Response(JSON.stringify({success:!url.endsWith('/init')}));
 await assert.rejects(freshBenchmarkSites(benchmarkPlan(config).sites,{run,request}),/initialization failed/);assert.equal(calls.filter(args=>args[0]==='rm').length,1);
});

test('official normalized dataset export has a separate pin and rejects arbitrary or changed datasets',()=>{
 assert.match(DATASET_EXPORT_SHA256,/^[a-f0-9]{64}$/);
 assert.notEqual(DATASET_EXPORT_SHA256,'d65275660814663375028e9017e1f929e3c38321041b125795e2713b52243d30');
 assert.throws(()=>validateDatasetExport('[]'),/export checksum mismatch/);
});
