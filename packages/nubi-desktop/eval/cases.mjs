// Loads and validates evaluation cases. A case holds the request the model
// sees and the answer key the model never sees. Answer keys stay in this
// folder: nothing here is copied into a workspace.
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CORPORA} from './corpus.mjs';

export const CASE_DIRECTORY=path.join(path.dirname(fileURLToPath(import.meta.url)),'cases');
export const SUITES=Object.freeze(['wiki','source','edit','document','conversation']);
export const SPLITS=Object.freeze(['dev','holdout']);
export const APPROVALS=Object.freeze(['patch','new_file']);
const EXPECT_KEYS=new Set(['state','asked','answer_includes','answer_excludes','answer_flags','retrieved','cited','files','test','unchanged_except','compacted']);
const CASE_KEYS=new Set(['id','title','suite','split','corpus','request','criteria','followUps','dialogue','approvals','stopAtQuestion','modelLimits','manual','expect']);
const text=(value,max=20000)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const list=(value,check,{min=0,max=50}={})=>Array.isArray(value)&&value.length>=min&&value.length<=max&&value.every(check);
const relative=value=>text(value,500)&&!path.isAbsolute(value)&&!value.split('/').includes('..')&&!value.includes('\\');
const pattern=value=>{if(!text(value,500))return false;try{new RegExp(value,'iu');return true;}catch{return false;}};
// An alternative is a literal, or a regular expression when it starts with "re:".
const alternative=value=>text(value,300)&&(!value.startsWith('re:')||pattern(value.slice(3)));

export function validateCase(value){
  const problems=[],need=(ok,problem)=>{if(!ok)problems.push(problem);};
  if(!value||typeof value!=='object'||Array.isArray(value))return ['case_not_object'];
  for(const key of Object.keys(value))need(CASE_KEYS.has(key),'unknown_key:'+key);
  need(typeof value.id==='string'&&/^[A-Z][0-9]{1,2}-[a-z0-9-]{3,40}$/.test(value.id),'id');
  need(text(value.title,80),'title');
  need(SUITES.includes(value.suite),'suite');need(SPLITS.includes(value.split),'split');need(Object.hasOwn(CORPORA,value.corpus||''),'corpus');
  need(text(value.request,16000),'request');
  need(value.criteria===undefined||list(value.criteria,item=>text(item,1000),{max:30}),'criteria');
  need(value.followUps===undefined||list(value.followUps,item=>text(item,16000)||item&&typeof item==='object'&&relative(item.file)&&(item.before===undefined||typeof item.before==='string')&&(item.after===undefined||typeof item.after==='string'),{min:1,max:6}),'followUps');
  need(value.dialogue===undefined||list(value.dialogue,item=>item&&pattern(item.match)&&text(item.answer,2000),{max:10}),'dialogue');
  need(value.approvals===undefined||list(value.approvals,item=>APPROVALS.includes(item),{max:2}),'approvals');
  need(value.stopAtQuestion===undefined||typeof value.stopAtQuestion==='boolean','stopAtQuestion');
  need(value.manual===undefined||typeof value.manual==='boolean','manual');
  need(value.modelLimits===undefined||value.modelLimits&&Number.isSafeInteger(value.modelLimits.contextLength)&&value.modelLimits.contextLength>=16000,'modelLimits');
  const expect=value.expect;
  if(!expect||typeof expect!=='object'||Array.isArray(expect)){problems.push('expect');return problems;}
  for(const key of Object.keys(expect))need(EXPECT_KEYS.has(key),'unknown_expect:'+key);
  need(['review','waiting_input'].includes(expect.state),'expect.state');
  need(expect.asked===undefined||typeof expect.asked==='boolean','expect.asked');
  need(expect.answer_includes===undefined||list(expect.answer_includes,group=>list(group,alternative,{min:1,max:20}),{min:1,max:12}),'expect.answer_includes');
  for(const key of ['answer_excludes','answer_flags'])need(expect[key]===undefined||list(expect[key],alternative,{min:1,max:12}),'expect.'+key);
  need(expect.retrieved===undefined||expect.retrieved&&list(expect.retrieved.paths,relative,{min:1,max:12})&&Number.isSafeInteger(expect.retrieved.min)&&expect.retrieved.min>=1&&expect.retrieved.min<=expect.retrieved.paths.length,'expect.retrieved');
  need(expect.cited===undefined||expect.cited&&list(expect.cited.paths,relative,{min:1,max:12}),'expect.cited');
  need(expect.files===undefined||list(expect.files,file=>file&&relative(file.path)&&(file.absent===undefined||typeof file.absent==='boolean')&&(file.includes===undefined||list(file.includes,item=>text(item,500),{min:1,max:12}))&&(file.excludes===undefined||list(file.excludes,item=>text(item,500),{min:1,max:12})),{min:1,max:12}),'expect.files');
  need(expect.test===undefined||expect.test&&list(expect.test.command,item=>text(item,300),{min:1,max:12})&&expect.test.command[0]==='node'&&(expect.test.files===undefined||expect.test.files&&typeof expect.test.files==='object'&&Object.entries(expect.test.files).every(([file,content])=>relative(file)&&text(content,20000))),'expect.test');
  need(expect.unchanged_except===undefined||list(expect.unchanged_except,relative,{max:12}),'expect.unchanged_except');
  need(expect.compacted===undefined||typeof expect.compacted==='boolean','expect.compacted');
  // A case that stops at its question must expect that question.
  need(!value.stopAtQuestion||expect.state==='waiting_input'&&expect.asked===true,'stopAtQuestion_expectation');
  need(expect.state!=='waiting_input'||value.stopAtQuestion===true,'waiting_input_requires_stopAtQuestion');
  need(!expect.compacted||value.modelLimits!==undefined,'compacted_requires_modelLimits');
  return problems;
}

async function resolveTurns(value,directory){
  const followUps=[];
  for(const item of value.followUps||[]){
    if(typeof item==='string'){followUps.push(item);continue;}
    const body=await readFile(path.join(directory,item.file),'utf8');
    followUps.push((item.before||'')+body+(item.after||''));
  }
  if(followUps.some(turn=>turn.length>16000))throw new Error('case_invalid:'+value.id+':followUp_too_long');
  return followUps;
}

export async function loadCases({directory=CASE_DIRECTORY,ids,suites,split}={}){
  const files=(await readdir(directory)).filter(name=>name.endsWith('.json')).sort(),cases=[];
  for(const name of files){
    let value;try{value=JSON.parse(await readFile(path.join(directory,name),'utf8'));}catch{throw new Error('case_unreadable:'+name);}
    const problems=validateCase(value);
    if(problems.length)throw new Error('case_invalid:'+name+':'+problems.join(','));
    if(name!==value.id+'.json')throw new Error('case_invalid:'+name+':file_name');
    cases.push({...value,followUps:await resolveTurns(value,directory)});
  }
  if(new Set(cases.map(item=>item.id)).size!==cases.length)throw new Error('case_duplicate');
  const selected=cases.filter(item=>(!ids||ids.includes(item.id))&&(!suites||suites.includes(item.suite))&&(!split||item.split===split));
  if(ids?.some(id=>!cases.some(item=>item.id===id)))throw new Error('case_unknown');
  return selected;
}
