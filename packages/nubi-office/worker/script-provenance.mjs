import {createHash} from 'node:crypto';
const hash=text=>createHash('sha256').update(text).digest('hex');
const slots=['draft/script-result.json','draft/script-result-next.json'];
const fail=code=>{throw new Error(code);};

// Two owned output slots, with flattened source dependencies. Reusing a slot
// must not erase ancestry or turn user-edited output into an executed receipt.
export function createScriptProvenance({get,isBound}){
  const outputs=new Map();
  const matches=(path,sha256)=>{const text=get(path);return typeof text==='string'&&hash(text)===sha256;};
  const current=dependencies=>dependencies.every(d=>matches(d.path,d.sha256));
  function prepare({path,code,inputPath,raw}){
    const parent=inputPath?outputs.get(inputPath):undefined;
    if(parent&&(!matches(inputPath,parent.sha256)||!current(parent.dependencies)))fail('script_dependency_changed');
    const dependencies=new Map((parent?.dependencies||[]).map(d=>[d.path,d.sha256]));
    dependencies.set(path,hash(code));
    if(inputPath&&!parent)dependencies.set(inputPath,hash(raw));
    const sources=[...dependencies].sort(([a],[b])=>a.localeCompare(b)).map(([path,sha256])=>({path,sha256}));
    // The same bounded workspace cannot accumulate an unbounded chain log.
    if(sources.length>16)fail('script_dependency_limit');
    const resultPath=slots.find(slot=>slot!==inputPath&&!dependencies.has(slot)&&!isBound(slot)&&
      (get(slot)===undefined||outputs.has(slot)&&matches(slot,outputs.get(slot).sha256)));
    if(!resultPath)fail('script_result_conflict');
    return{dependencies:sources,resultPath,previous:get(resultPath)};
  }
  function verify(prepared){
    if(!current(prepared.dependencies))fail('script_dependency_changed');
    if(get(prepared.resultPath)!==prepared.previous||isBound(prepared.resultPath))fail('script_result_conflict');
  }
  function commit(prepared,output){outputs.set(prepared.resultPath,{sha256:hash(output),dependencies:structuredClone(prepared.dependencies)});}
  function view(path){const receipt=outputs.get(path);return receipt?{dependencies:structuredClone(receipt.dependencies),current:matches(path,receipt.sha256)&&current(receipt.dependencies)}:undefined;}
  return{prepare,verify,commit,current,view};
}
