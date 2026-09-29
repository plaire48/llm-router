// Development harness only. Fresh pinned containers, product UI, scoped HAR.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
const exec=promisify(execFile);
export const digest=data=>createHash('sha256').update(data).digest('hex');
export const command=async(file,args)=>{const result=await exec(file,args,{timeout:180000,maxBuffer:16*1024*1024});return result.stdout.trim();};
// Official 1.2.3 dataset-get serializes normalized models. This export hash is
// deliberately separate from the original dataset checksum used by the grader.
export const DATASET_EXPORT_SHA256='10752f67cb4652831da85419925863cc5315db9c53bae42370046b70f032484f';
export function validateDatasetExport(data) {
 const hash=digest(String(data).replace(/\r\n/g,'\n'));
 if(hash!==DATASET_EXPORT_SHA256)throw Error('Official dataset export checksum mismatch');
 return hash;
}
const SPECS={shopping:{port:80,header:'X-M2-Customer-Auto-Login',path:''},shopping_admin:{port:80,header:'X-M2-Admin-Auto-Login',path:'/admin'},reddit:{port:80,header:'X-Postmill-Auto-Login',path:''},gitlab:{port:8023,path:''}};
export function benchmarkPlan(config) {
 if(config?.isolatedBenchmark!==true || !config.sites || !Object.keys(config.sites).length)throw Error('A disposable benchmark configuration is required');
 const used=new Set(),sites={};
 for(const [name,value] of Object.entries(config.sites)) {
  const spec=SPECS[name];
  if(!spec || !new RegExp(`^am1n3e/webarena-verified-${name}@sha256:[a-f0-9]{64}$`).test(value.image||''))throw Error('Use a supported official site image pinned by digest');
  for(const port of [value.port,value.controlPort]){if(!Number.isInteger(port)||port<1024||port>65535||used.has(port))throw Error('Use unique unprivileged benchmark ports');used.add(port);}
  if(value.headers && Object.entries(value.headers).some(([key,val])=>key!==spec.header || typeof val!=='string' || /[\r\n]/.test(val)))throw Error('Only the site-specific benchmark login header is supported');
  sites[name]={name,image:value.image,port:value.port,controlPort:value.controlPort,containerPort:spec.port,origin:`http://127.0.0.1:${value.port}`,url:`http://127.0.0.1:${value.port}${spec.path}`,headers:value.headers||{}};
 }
 return {sites,environments:Object.fromEntries(Object.values(sites).map(site=>[`__${site.name.toUpperCase()}__`,{urls:[site.url]}]))};
}
export function benchmarkOrigins(sites) {return new Set(Object.values(sites).map(site=>new URL(site.origin).origin));}
export function benchmarkHarFilter(sites) {
 const origins=[...benchmarkOrigins(sites)];if(!origins.length)throw Error('Empty benchmark capture scope');
 return new RegExp(`^(?:${origins.map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})(?:/|$)`);
}
export function validateAgentInputs(inputs,ids,plan) {
 if(!Array.isArray(inputs)||inputs.length!==ids.length||new Set(ids).size!==ids.length)throw Error('Incomplete or duplicate benchmark plan');
 return ids.map(id=>{
  const matches=inputs.filter(task=>task.task_id===id);if(matches.length!==1)throw Error('Missing task');const task=matches[0];
  if(typeof task.intent!=='string'||!task.intent.trim()||!task.sites?.length||task.sites.some(site=>!plan.sites[site]))throw Error('Unsupported task environment');
  const allowed=benchmarkOrigins(Object.fromEntries(task.sites.map(site=>[site,plan.sites[site]])));
  if(!task.start_urls?.length||task.start_urls.some(url=>{try{return !allowed.has(new URL(url).origin);}catch{return true;}}))throw Error('Task URL outside benchmark');
  // Do not forward any expected answers/evaluator metadata, even if supplied.
  return {task_id:id,intent:task.intent,sites:task.sites,start_urls:task.start_urls};
 });
}
export async function freshBenchmarkSites(sites,{run=command,request=fetch}={}) {
 const runId=randomUUID(),owned=[],receipts=[];
 const close=async()=>{
  for(const id of owned.splice(0).reverse()) {
   const label=await run('docker',['inspect','--format','{{ index .Config.Labels "nubi.benchmark.run" }}',id]);
   if(label!==runId)throw Error('Benchmark container ownership changed');
   await run('docker',['rm','-f','-v',id]);
  }
 };
 try{
  for(const site of Object.values(sites)) {
   await run('docker',['image','inspect',site.image]); // No unrequested download.
   const id=await run('docker',['run','--pull=never','-d','--name',`nubi-eval-${site.name}-${runId}`,'--label',`nubi.benchmark.run=${runId}`,'-p',`127.0.0.1:${site.port}:${site.containerPort}`,'-p',`127.0.0.1:${site.controlPort}:8877`,'-e',`WA_ENV_CTRL_EXTERNAL_SITE_URL=${site.url}`,site.image]);
   if(!/^[a-f0-9]{12,64}$/.test(id))throw Error('Invalid owned container receipt');owned.push(id);
   const control=`http://127.0.0.1:${site.controlPort}`;
   const deadline=Date.now()+180000;
   let ready=false;
   while(Date.now()<deadline){try{const response=await request(control+'/status',{signal:AbortSignal.timeout(5000)});const data=await response.json();if(response.ok&&data.success===true){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
   if(!ready)throw Error('Benchmark environment not ready');
   const response=await request(control+'/init',{method:'POST',signal:AbortSignal.timeout(120000)});const init=await response.json();if(!response.ok||init.success!==true)throw Error('Benchmark URL initialization failed');
   receipts.push({site:site.name,containerId:id,image:site.image,reset:'new-container-no-reused-volumes',initialized:true});
  }
  return {receipts,close};
 }catch(error){try{await close();}catch{throw Error('Environment setup failed and owned container cleanup needs inspection');}throw error;}
}
export function parseBenchmarkAnswer(text) {
 const raw=String(text).trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/,'$1');
 const value=JSON.parse(raw);
 if(!['RETRIEVE','MUTATE','NAVIGATE'].includes(value.task_type)||!['SUCCESS','ACTION_NOT_ALLOWED_ERROR','PERMISSION_DENIED_ERROR','NOT_FOUND_ERROR','DATA_VALIDATION_ERROR','UNKNOWN_ERROR'].includes(value.status))throw Error('Invalid official answer');
 if(value.status==='SUCCESS'&&value.error_details!=null || value.task_type==='RETRIEVE'&&!Array.isArray(value.retrieved_data))throw Error('Invalid official answer');
 return value; // The official evaluator performs the final schema/semantic grading.
}
export function validateBenchmarkHar(har,sites) {
 if(!Array.isArray(har?.log?.entries))throw Error('Missing HAR entries');
 const origins=benchmarkOrigins(sites);
 if(har.log.entries.some(entry=>!origins.has(new URL(entry.request.url).origin)))throw Error('HAR contains traffic outside the benchmark');
 return {entries:har.log.entries.length,origins:[...new Set(har.log.entries.map(entry=>new URL(entry.request.url).origin))]};
}
export const RESPONSE_INSTRUCTION='Return your final answer as JSON with task_type (RETRIEVE, MUTATE, or NAVIGATE), status (SUCCESS or ACTION_NOT_ALLOWED_ERROR/PERMISSION_DENIED_ERROR/NOT_FOUND_ERROR/DATA_VALIDATION_ERROR/UNKNOWN_ERROR), retrieved_data (array for RETRIEVE, otherwise null), and error_details (null on success). Preserve the user task output field names. Follow normal user approval boundaries; do not infer approval from the benchmark.';
