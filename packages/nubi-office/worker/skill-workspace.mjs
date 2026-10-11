import {officeCapabilities} from './office-capabilities.mjs';
import {createRegisteredSkills} from './registered-skills.mjs';
import {retainedAnswers} from './input-contract.mjs';
import {documentSkill as validateDocumentSkill,documentSkillMarkdown} from './document-skill.mjs';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createReadTool,createFindTool,createEditTool,createWriteTool,loadSkillsFromDir,formatSkillsForPrompt,truncateHead} from '@earendil-works/pi-coding-agent';
import {runDocumentScript,scriptInput} from './script-runtime.mjs';
import {characterPage,linePage} from './workspace-read.mjs';
import {diagnoseDraft} from './workspace-diagnostics.mjs';
import {createPythonRuntime} from './python-runtime.mjs';
import {createScriptProvenance} from './script-provenance.mjs';

const root=fileURLToPath(new URL('./skills/',import.meta.url));
const hash=text=>createHash('sha256').update(text).digest('hex');
const fail=code=>{throw new Error(code);};
let bundled;
function resources(){
  if(bundled)return bundled;
  const result=loadSkillsFromDir({dir:root,source:'nubi-office-bundled'}),files=new Map();
  function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
    if(entry.isSymbolicLink())fail('skill_resource_invalid');
    const absolute=path.join(dir,entry.name);
    if(entry.isDirectory())walk(absolute);
    else if(/\.(md|json|py|js)$/.test(entry.name)){
      const text=readFileSync(absolute,'utf8');if(text.length>60000)fail('skill_resource_invalid');
      files.set('skills/'+path.relative(root,absolute).split(path.sep).join('/'),text);
    }
  }}walk(root);
  if(result.diagnostics.some(d=>d.type==='error')||result.skills.length!==3)fail('skill_resource_invalid');
  bundled={files,skills:result.skills.map(skill=>({...skill,filePath:'skills/'+path.relative(root,skill.filePath).split(path.sep).join('/')}))};return bundled;
}

// Pi owns discovery, tool schemas, line paging, edit matching, mutation queues
// and diffs. This adapter provides a run-local memory backend, never host files.
export function createSkillWorkspace({host,signal,activity,metrics,approve,pythonOptions={},documentSkill,documentSkillAnswers=[],skillCall,officeRuntime}){
  const source=resources(),files=new Map([...source.files].filter(([key])=>key.startsWith('skills/'+host+'-2016/'))),bindings=new Map(),accessed=new Set();
  const cwd=path.resolve('.nubi-memory',randomUUID()),skills=source.skills.filter(s=>s.name===host+'-2016');
  if(documentSkill&&!documentSkill.package){const skill=validateDocumentSkill(documentSkill,host),filePath=`skills/document-${skill.id}/SKILL.md`;files.set(filePath,documentSkillMarkdown(skill));skills.push({name:`document-${skill.id}`,description:skill.name,filePath,baseDir:`skills/document-${skill.id}`,source:'user',disableModelInvocation:false});}
  const registered=createRegisteredSkills({host,selected:documentSkill,call:skillCall,signal,files,skills});
  const selectedRule=documentSkill&&!documentSkill.package?validateDocumentSkill(documentSkill,host):null;
  const skillContext=()=>{const context=registered.context();return {...context,
    active:[...context.active,...(selectedRule?[{id:selectedRule.id,revision:selectedRule.revision,name:selectedRule.name,source:'selected-writing-rule',baseDir:`skills/document-${selectedRule.id}`,instructions:documentSkillMarkdown(selectedRule),requiredInputs:structuredClone(selectedRule.questions),previousAnswers:retainedAnswers(documentSkillAnswers)}]:[])],
    guidance:context.guidance,officeCapabilities:officeCapabilities(host,officeRuntime)};};

  const allKeys=()=>[...new Set([...files.keys(),...bindings.keys(),...registered.paths()])];
  const stats=metrics.skillWorkspace={engine:'pi-coding-agent',version:'0.86.1',reads:0,edits:0,writes:0,searches:0,scriptRuns:0,scriptFailures:0,activeSkills:[]};
  const python=createPythonRuntime({...pythonOptions,approve,signal,activity});
  let lastScript=null,scriptRunning=false;
  const diagnostics=new Map();
  const diagnosticView=value=>({...value,current:typeof get(value.path)==='string'&&hash(get(value.path))===value.sha256});
  async function inspectDraft(key,text){
    const pending={path:key,sha256:hash(text),status:'pending',executed:false,scope:'syntax_only'};
    diagnostics.set(key,pending);
    try{
      const result=await diagnoseDraft(key,text,signal);
      if(diagnostics.get(key)===pending)diagnostics.set(key,result);
      return diagnosticView(result);
    }catch(error){
      if(diagnostics.get(key)===pending)diagnostics.set(key,{...pending,status:'cancelled'});
      throw error;
    }
  }
  const check=()=>{if(signal.aborted)fail('cancelled');};
  function keyOf(absolute){
    const key=path.relative(cwd,absolute).split(path.sep).join('/');
    if(!key||key==='..'||key.startsWith('../')||path.isAbsolute(key)||key.includes(':'))fail('workspace_out_of_scope');return key;
  }
  function validInput(input){
    if(typeof input!=='string'||input.length>240||input.includes('\\')||input.startsWith('/')||input.includes(':')||input.split('/').some(s=>s==='..'||s==='.'||!s)||input.startsWith('~')||input.startsWith('@'))fail('workspace_out_of_scope');
    return input;
  }
  const get=key=>bindings.has(key)?bindings.get(key).read():files.get(key);
  const present=key=>typeof get(key)==='string';
  const provenance=createScriptProvenance({get,isBound:key=>bindings.has(key)});
  function editable(key){if(!key.startsWith('draft/')||!/^draft\/[a-zA-Z0-9_-]+\.(json|md|txt|py|js)$/.test(key))fail('workspace_read_only');}
  async function readFile(absolute){check();const key=keyOf(absolute),text=get(key);if(typeof text!=='string')fail('workspace_file_missing');return Buffer.from(text);}
  function storeDraft(absolute,text){
    check();const key=keyOf(absolute);editable(key);
    const draftKeys=[...new Set([...files.keys(),...bindings.keys()])].filter(name=>name.startsWith('draft/'));
    if(typeof text!=='string'||text.length>60000||draftKeys.length>=8&&!draftKeys.includes(key))fail('workspace_limit');
    const total=draftKeys.filter(name=>name!==key).reduce((n,name)=>n+(get(name)?.length||0),0);
    if(total+text.length>120000)fail('workspace_limit');
    if(bindings.has(key))bindings.get(key).write(text);else files.set(key,text);
    check();
  }
  const writeFile=async(absolute,text)=>storeDraft(absolute,text);
  const access=async absolute=>{check();if(!present(keyOf(absolute)))fail('workspace_file_missing');};
  const sdk=[createReadTool(cwd,{operations:{readFile,access,detectImageMimeType:async()=>null}}),createFindTool(cwd,{operations:{
    exists:absolute=>absolute===cwd||allKeys().some(key=>path.resolve(cwd,key).startsWith(absolute+path.sep)),
    glob:(pattern,searchPath,{limit})=>{check();if(searchPath!==cwd)keyOf(searchPath);return allKeys().filter(key=>present(key)||registered.contains(key)).map(key=>path.resolve(cwd,key)).filter(absolute=>absolute.startsWith(searchPath+path.sep)&&path.posix.matchesGlob(pattern.includes('/')?path.relative(searchPath,absolute).split(path.sep).join('/'):path.basename(absolute),pattern)).slice(0,limit);}
  }}),createEditTool(cwd,{operations:{readFile,writeFile,access}}),createWriteTool(cwd,{operations:{writeFile,mkdir:async absolute=>{check();if(absolute!==cwd)keyOf(absolute);}}})];
  const descriptions={read:'Read bundled or registered skill/reference text or a memory draft by path. Use 1-based offset and limit for paging; at most 120 lines and 12 KB per result.',find:'Find bundled or registered skill/reference text and memory drafts by glob. Paths are relative to the search directory. Use the default workspace root or a relative directory; at most 50 results.',edit:'Apply exact, unique, non-overlapping text replacements to an existing memory draft. Read the current text before editing. Returns a diff and syntax diagnostics for JavaScript/JSON. A committed edit can contain errors: repair diagnostics without replaying the edit.',write:'Create or replace a memory draft, at most 60,000 characters. Use edit for targeted corrections to preserve existing content. Returns syntax diagnostics for JavaScript/JSON without executing code. Committed invalid drafts remain available for correction.'};
  const tools=sdk.map(t=>({type:'function',function:{name:t.name,description:descriptions[t.name]+' Scope: ONLY bundled/registered resources and this run\'s in-memory drafts. No filesystem, script execution, native Office writes, or saved artifacts. Use draft/sheet.json for the bound Excel sheet when available.',parameters:JSON.parse(JSON.stringify(t.parameters))}}));
  const readSchema=tools.find(t=>t.function.name==='read').function;
  Object.assign(readSchema.parameters.properties,{
    charOffset:{type:'integer',minimum:0,description:'Zero-based Unicode code point offset. Alternative to line offset/limit; long lines automatically return this mode.'},
    charLimit:{type:'integer',minimum:1,maximum:4000,description:'Code points per character page, also bounded to 12 KB.'},
    expectedSha256:{type:'string',pattern:'^[a-f0-9]{64}$',description:'Source hash from the previous page; required when charOffset is greater than zero.'}
  });
  readSchema.description+=' Read content is exact source text, including original line separators, with no added notices. Follow nextOffset or nextCharOffset with expectedSha256 from this result. For long lines, follow nextCharOffset with charOffset and expectedSha256 from this result. Character pages contain exact raw text, at most 4000 Unicode code points / 12 KB. Never mix pages with different hashes.';
  tools.push({type:'function',function:{name:'run_script',description:'Execute a memory .js or .py file for document calculations or data preparation. For JavaScript define function transform(input); for Python use def transform(input) and first prepare_python. Python requires explicit approval for each exact script and input and runs locally with user permissions, not an OS sandbox. Return finite JSON data. Supply exactly one of input (JSON string) or inputPath (existing workspace JSON). JavaScript CPU 250 ms and memory 16 MB; shared code 32000 chars, input 48000 chars, output 24000 chars. JavaScript has no imports, async, filesystem, network, Office API or packages. Python supports installed imports and a 30 second process limit; use only supplied JSON data and never open NASCA/Office source files or bypass native tools. On success stores the result at returned resultPath, separate from inputPath. Chained results retain source dependencies; stale inputs or occupied output slots are rejected without overwriting drafts. Inspect the result and use guarded Office tools separately; execution is not document completion.',parameters:{type:'object',properties:{path:{type:'string',maxLength:240},input:{type:'string',maxLength:48000},inputPath:{type:'string',maxLength:240}},required:['path'],additionalProperties:false}}});
  tools.push({type:'function',function:{name:'prepare_python',description:'Prepare a local Python 3.12 environment for the current document-authoring skill, after user approval. Supply exact package==version requirements OR requirementsPath to a workspace JSON array. Missing runtime/packages download through bundled uv into a Nubi-only environment. No shell commands, URLs, system pip changes or native document writes. On failure inspect the receipt; do not loop or bypass approval.',parameters:{type:'object',properties:{requirements:{type:'array',maxItems:12,items:{type:'string',maxLength:123}},requirementsPath:{type:'string',maxLength:240}},additionalProperties:false}}});
  tools.push(...registered.tools,{type:'function',function:{name:'office_capabilities',description:'Inspect implemented Office 2016 operations, unsupported features, skill/script routes and native add-in runtime evidence. Coverage is not proof of successful execution. Use before selecting tools for an unfamiliar skill or feature; a skill cannot add missing Office operations.',parameters:{type:'object',properties:{},additionalProperties:false}}});
  async function preparePython(args){
    if(Object.hasOwn(args,'requirements')===Object.hasOwn(args,'requirementsPath'))fail('tool_arguments_invalid');
    let requirements=args.requirements;
    if(args.requirementsPath!==undefined){validInput(args.requirementsPath);await registered.ensure(args.requirementsPath);const text=get(args.requirementsPath);if(typeof text!=='string')fail('workspace_file_missing');try{requirements=JSON.parse(text);}catch{fail('python_requirements_invalid');}}
    return {scope:'local_dependency_environment',...await python.prepare(requirements)};
  }
  async function runScript(args){
    validInput(args.path);const isPython=args.path.endsWith('.py');if(!isPython&&!args.path.endsWith('.js'))fail('script_language_unsupported');
    await registered.ensure(args.path);
    const code=get(args.path);if(typeof code!=='string')fail('workspace_file_missing');
    if(Object.hasOwn(args,'input')===Object.hasOwn(args,'inputPath'))fail('tool_arguments_invalid');
    if(args.inputPath!==undefined){validInput(args.inputPath);if(!args.inputPath.endsWith('.json'))fail('script_input_invalid');}
    if(args.inputPath!==undefined)await registered.ensure(args.inputPath);
    const raw=args.inputPath===undefined?args.input:get(args.inputPath);let input;
    if(typeof raw!=='string'||raw.length>48000)fail('script_input_limit');
    try{input=JSON.parse(raw);}catch{fail('script_input_invalid');}
    const inputJson=scriptInput(input),codeSha256=hash(code),inputSha256=hash(inputJson);
    if(scriptRunning)fail('script_busy');
    const prepared=provenance.prepare({path:args.path,code,inputPath:args.inputPath,raw});
    scriptRunning=true;
    try{
      const validate=()=>{check();if(get(args.path)!==code||args.inputPath!==undefined&&get(args.inputPath)!==raw)fail('script_source_changed');provenance.verify(prepared);};
      const result=isPython?await python.run({code,input,validate}):await runDocumentScript({code,input,signal});check();
      if(result.error)throw Object.assign(new Error(result.error),{scriptDetail:result.detail,scriptErrorName:result.errorName,scriptLine:result.line});
      if(get(args.path)!==code||args.inputPath!==undefined&&get(args.inputPath)!==raw)fail('script_source_changed');
      provenance.verify(prepared);
      const {resultPath,dependencies}=prepared;
      // Validation, store and receipt publication are synchronous in this host.
      storeDraft(path.resolve(cwd,resultPath),result.outputJson);
      provenance.commit(prepared,result.outputJson);
      lastScript={...(isPython?{pythonEnvironment:result.environment}:{}),path:args.path,codeSha256,inputSha256,...(args.inputPath?{inputPath:args.inputPath,inputSourceSha256:hash(raw)}:{}),outputSha256:hash(result.outputJson),resultPath,dependencies};stats.scriptRuns++;
      return{scope:'run_memory_only',executed:true,engine:isPython?'local-cpython':'quickjs-wasm',...structuredClone(lastScript),output:result.output,instruction:'This is the executed script result, not verified business truth or an Office change. Check source data and expected values. Read the resultPath after context renewal. Use existing guarded Office authoring/apply/readback and save approval.'};
    }finally{scriptRunning=false;}
  }
  function recordRead(args,text,page){
    const digest=hash(text);stats.reads++;
    accessed.add(JSON.stringify([args.path,page?.readMode||'lines',page?.charOffset??args.offset??1,page?.readChars??args.limit,digest]));
    if(accessed.size>256)accessed.delete(accessed.values().next().value);
    const active=skills.find(skill=>skill.filePath===args.path)?.name;if(active&&!stats.activeSkills.includes(active))stats.activeSkills.push(active);
    return digest;
  }
  function readCharacters(args,text,event){
    const page=characterPage(text,args),sha256=recordRead(args,text,page);
    activity.end(event,{detail:args.path});
    return{scope:'run_memory_only',path:args.path,sha256,...page,...(provenance.view(args.path)?{scriptProvenance:provenance.view(args.path)}:{}),instruction:'Exact source text fragment. If truncated, continue read with nextCharOffset as charOffset and this sha256 as expectedSha256. Concatenate content in order; do not treat a fragment as complete JSON. Native scope and approvals are unchanged.'};
  }
  async function execute(name,input){
    check();const tool=sdk.find(t=>t.name===name);if(!tool&&!registered.has(name)&&!['office_capabilities','run_script','prepare_python'].includes(name))fail('unsupported_operation');
    const args=structuredClone(input||{});let readSource;
    const event=activity.start(({read:'참고 문서 읽기',find:'문서와 스킬 찾기',edit:'초안 코드 수정',write:'초안 코드 작성',run_script:'계산 코드 실행',office_capabilities:'Office 지원 기능 확인',prepare_python:'Python 환경 확인',list_document_skills:'등록 스킬 찾기',use_document_skill:'등록 스킬 불러오기'})[name],{tool:name});
    try{
      if(name==='office_capabilities'){activity.end(event,{detail:'지원 기능과 미확인 항목'});return officeCapabilities(host,officeRuntime);}
      if(registered.has(name)){const result=await registered.execute(name,args);activity.end(event,{detail:result.name||'등록된 스킬 목록'});return result;}
      if(name==='prepare_python'){const result=await preparePython(args);activity.end(event,{detail:'Python 환경을 준비했습니다.'});return result;}
      if(name==='run_script'){const result=await runScript(args);activity.end(event,{detail:'계산 결과를 받았습니다. 문서 반영 전에 값을 확인합니다.'});return result;}
      if(name==='find'){
        if(typeof args.pattern!=='string'||args.pattern.length>160||args.pattern.includes('..')||args.pattern.includes('\\')||args.pattern.includes(':')||args.pattern.startsWith('/'))fail('workspace_out_of_scope');
        if(args.path!==undefined&&args.path!=='.')validInput(args.path);
        if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1))fail('tool_arguments_invalid');args.limit=Math.min(args.limit??30,50);
      }else{
        validInput(args.path);if(name==='edit'||name==='write')editable(args.path);
        if(name==='read'){
          const asset=present(args.path)?null:await registered.ensure(args.path);if(asset){activity.end(event,{detail:'바이너리 자산 정보'});return asset;}
          const text=get(args.path);if(typeof text!=='string')fail('workspace_file_missing');
          readSource=text;
          if(args.expectedSha256!==undefined){if(typeof args.expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(args.expectedSha256))fail('tool_arguments_invalid');if(hash(text)!==args.expectedSha256)fail('workspace_source_changed');}
          if(args.charOffset!==undefined||args.charLimit!==undefined){
            if(args.offset!==undefined||args.limit!==undefined||args.charOffset>0&&!args.expectedSha256)fail('tool_arguments_invalid');
            return readCharacters(args,text,event);
          }
          if(args.offset!==undefined&&(!Number.isSafeInteger(args.offset)||args.offset<1)||args.limit!==undefined&&(!Number.isSafeInteger(args.limit)||args.limit<1))fail('tool_arguments_invalid');args.limit=Math.min(args.limit??80,120);
        }
        if(JSON.stringify(args).length>70000)fail('workspace_limit');
      }
      const result=await tool.execute(randomUUID(),args,signal);check();
      if(name==='read'){
        if(get(args.path)!==readSource)fail('workspace_source_changed');
        const page=linePage(readSource,args),sha256=recordRead(args,readSource,page);
        activity.end(event,{detail:args.path});
        return{scope:'run_memory_only',path:args.path,sha256,...page,...(provenance.view(args.path)?{scriptProvenance:provenance.view(args.path)}:{}),instruction:'Exact source text only; concatenate content in order. If truncated, follow nextOffset (line mode) or nextCharOffset (character mode) with this sha256 as expectedSha256. A fragment is not complete JSON or evidence of unseen content. Native scope and approvals are unchanged.'};
      }
      const body=result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'),bounded=truncateHead(body,{maxLines:160,maxBytes:12000});
      if(name==='find')stats.searches++;else stats[name==='edit'?'edits':'writes']++;
      const mutation=name==='edit'||name==='write',writtenText=mutation?get(args.path):undefined;
      const diagnostic=mutation?await inspectDraft(args.path,writtenText):undefined;
      activity.end(event,{state:diagnostic?.status==='invalid'?'waiting':'done',detail:diagnostic?.status==='invalid'?'초안을 반영했습니다. 문법 오류를 수정합니다.':args.path||args.pattern});
      return {scope:'run_memory_only',...(mutation?{committed:true,diagnostics:diagnostic}:{}),content:bounded.content,truncated:bounded.truncated||!!result.details?.truncation?.truncated||!!result.details?.resultLimitReached,
        ...(name==='edit'&&result.details?.diff?{diff:truncateHead(result.details.diff,{maxLines:80,maxBytes:6000}).content}:{}),
        ...(name==='find'?{searchPath:args.path||'.'}:{path:args.path,sha256:hash(mutation?writtenText:get(args.path))}),instruction:'A committed draft edit is retained even when diagnostics are invalid/unavailable. Correct invalid syntax with a NEW edit; do not replay committed changes. Syntax valid is not execution, type checking or business correctness. Diagnostics with current:false are stale: reread the changed source. Draft edits are NOT native edits, execution, saved files or completion. Continue with the guarded Office commit/apply and readback tools. If truncated, page reads with offset/limit or narrow the search pattern.'};
    }catch(error){if(signal.aborted){activity.end(event,{state:'cancelled',detail:'작업을 중지했습니다.'});check();}activity.end(event,{state:'error',detail:'입력과 현재 초안을 확인해 주세요.'});
      const code=/^[a-z_]{1,60}$/.test(error.message)&&/^(python_|workspace_|script_|document_|formula_|unsupported_formula|invalid_|tool_arguments_invalid$)/.test(error.message)?error.message:'workspace_edit_rejected';
      if(['run_script','prepare_python'].includes(name)){stats.scriptFailures++;return{error:code,...(error.scriptErrorName?{errorName:error.scriptErrorName}:{}),...(error.scriptDetail?{detail:error.scriptDetail}:{}),...(error.scriptLine?{line:error.scriptLine}:{}),instruction:'The script did not produce an accepted result. Previous accepted workspace drafts/results remain unchanged. Native Office tools were not invoked by this wrapper; a Python script can have local side effects. Read the code and input; correct the failing logic or reduce data/output. For script_dependency_changed, rebuild the affected chain from original input with fresh sources; do not consume stale intermediate results. For script_result_conflict, inspect both result slots and preserve user drafts; do not overwrite them to force a retry. Define synchronous transform(input) returning finite JSON. For Python, inspect errorName/line/missing module feedback, repair the code or exact package requirements through prepare_python, then request a new approved run. A failed/terminated local Python process may have side effects; never claim files are unchanged or blindly replay it. Do not repeat the same failure or claim success.'};}
      const reason=name==='edit'?(error.message.includes('must be unique')?'ambiguous_match':error.message.includes('Could not find')?'text_not_found':error.message.includes('overlap in')?'overlapping_edits':error.message.includes('identical content')?'no_change':undefined):undefined;
      return {error:code,...(reason?{reason}:{}),instruction:'Read the exact current text and correct the path or unique non-overlapping edits. For ambiguous_match include more surrounding text; for text_not_found use the latest read; for overlapping_edits combine replacements. The rejected tool has not changed the draft. Office documents remain unchanged.'};
    }
  }
  function scriptState(){
    if(!lastScript)return null;
    const matches=(key,digest)=>typeof get(key)==='string'&&hash(get(key))===digest;
    return{...structuredClone(lastScript),current:matches(lastScript.path,lastScript.codeSha256)&&matches(lastScript.resultPath,lastScript.outputSha256)&&(!lastScript.inputPath||matches(lastScript.inputPath,lastScript.inputSourceSha256))&&provenance.current(lastScript.dependencies)};
  }
  return{tools,initialize:registered.initialize,skillContext,has:name=>registered.has(name)||['office_capabilities','run_script','prepare_python'].includes(name)||sdk.some(t=>t.name===name),execute,
    bindDraft(key,binding){validInput(key);editable(key);bindings.set(key,binding);},
    context:()=>({skills:formatSkillsForPrompt(skills).replace('use that absolute path in tool commands.','use the resulting workspace-relative path in tool commands.'),registeredSkills:skillContext(),officeCapabilities:officeCapabilities(host,officeRuntime),files:allKeys().map(key=>({path:key,...(present(key)?{chars:get(key).length,sha256:hash(get(key))}:{available:false,lazy:registered.contains(key)})})),activeSkills:[...new Set([...stats.activeSkills,...registered.context().active.map(s=>'user-'+s.id)])],diagnostics:[...diagnostics.values()].map(diagnosticView),lastScript:scriptState(),python:python.context(),guidance:'Use list_document_skills to find relevant registered skills and use_document_skill to activate them. Read relevant SKILL.md before using it. Load reference contents only when needed. run_script executes pure JavaScript transform(input) in a bounded WASM runtime using explicit JSON input; it cannot access Office or install packages. Python .py scripts use def transform(input), prepare_python, and explicit installation/execution approval. Read references/python.md first. Python executes with local user permissions, not an OS sandbox. Never open NASCA files, modify Office through Python, pass credentials, or use shell commands. Return JSON for the existing native document tools. A lastScript or scriptProvenance with current:false has changed direct or upstream dependencies; rebuild the affected calculation chain from original input before reuse. Dependency tracking covers explicit inputPath chains, not manually copied values. Result slots owned by user drafts are never silently replaced. Resolve current invalid syntax diagnostics before run_script. Unsupported/unavailable/stale diagnostics are unverified, and valid syntax is not a successful execution or correct business result. Read and validate outputs before guarded native changes. Original request, native scope, HITL and verified receipts prevail.'}),
    progress:()=>({registeredSkills:skillContext().active.map(s=>[s.id,s.packageSha256]),python:python.context(),accessed:[...accessed],drafts:[...files].filter(([key])=>key.startsWith('draft/')).map(([key,value])=>[key,hash(value)])})};
}
