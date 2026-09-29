// Grades one finished case from observable results only. The model's own
// completion claim and the reviewer's "ready" never count toward a pass.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {changedPaths} from './corpus.mjs';
import {leaderToolResults} from './transcript.mjs';

const exec=promisify(execFile);
const normalize=value=>String(value||'').normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
// An alternative is a literal, or a regular expression when it starts with "re:".
export function mentions(text,alternative){
  if(alternative.startsWith('re:'))return new RegExp(alternative.slice(3),'iu').test(String(text||'').normalize('NFC'));
  return normalize(text).includes(normalize(alternative));
}
const check=(name,passed,detail={})=>({name,passed:passed===true,...detail});

async function runTest(root,test){
  for(const [file,content] of Object.entries(test.files||{})){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),content);}
  try{await exec(process.execPath,test.command.slice(1),{cwd:root,timeout:60000,maxBuffer:4e6,env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test'}});return {exitCode:0};}
  catch(error){return {exitCode:typeof error.code==='number'?error.code:1,timedOut:error.killed===true};}
}

// result: {state, answer, asked, compactions, transcript, root, reviewStatus, needsHuman, error}
export async function gradeCase(testCase,result){
  const expect=testCase.expect,checks=[],answer=result.answer||'';
  if(result.error)return {outcome:'error',passed:false,checks,error:result.error,falseCompletion:false};
  if(result.needsHuman)return {outcome:'needs_human',passed:false,checks,falseCompletion:false};
  // A case that needs compaction measures nothing when compaction did not happen.
  if(expect.compacted&&!(result.compactions>0))return {outcome:'invalid',passed:false,checks:[check('compacted',false,{compactions:result.compactions||0})],falseCompletion:false};
  checks.push(check('state',result.state===expect.state,{expected:expect.state,actual:result.state}));
  if(expect.asked!==undefined)checks.push(check('asked',result.asked===expect.asked,{expected:expect.asked,actual:result.asked}));
  for(const [index,group] of (expect.answer_includes||[]).entries())checks.push(check('answer_includes',group.some(item=>mentions(answer,item)),{group:index+1,alternatives:group}));
  for(const item of expect.answer_excludes||[])checks.push(check('answer_excludes',!mentions(answer,item),{forbidden:item}));
  if(expect.retrieved){
    const reached=leaderToolResults(result.transcript||[]).join('\n'),found=expect.retrieved.paths.filter(file=>reached.includes(file));
    checks.push(check('retrieved',found.length>=expect.retrieved.min,{found,min:expect.retrieved.min}));
  }
  if(expect.cited){
    const found=expect.cited.paths.filter(file=>mentions(answer,file)||mentions(answer,path.posix.basename(file)));
    checks.push(check('cited',found.length>0,{found}));
  }
  // The grader's own hidden test files are not the agent's changes, so grading twice gives the same result.
  const hidden=Object.keys(expect.test?.files||{});
  const changed=expect.unchanged_except?(await changedPaths(result.root)).filter(file=>!hidden.includes(file)):null;
  for(const file of expect.files||[]){
    let content=null;try{content=await readFile(path.join(result.root,file.path),'utf8');}catch{/* Missing file. */}
    if(file.absent){checks.push(check('files',content===null,{path:file.path,expected:'absent'}));continue;}
    const missing=(file.includes||[]).filter(item=>content===null||!content.includes(item)),present=(file.excludes||[]).filter(item=>content!==null&&content.includes(item));
    checks.push(check('files',content!==null&&!missing.length&&!present.length,{path:file.path,exists:content!==null,missing,present}));
  }
  if(changed){
    const outside=changed.filter(file=>!expect.unchanged_except.includes(file));
    checks.push(check('unchanged_except',outside.length===0,{outside,changed}));
  }
  if(expect.test)checks.push(check('test',(await runTest(result.root,expect.test)).exitCode===0,{command:expect.test.command}));
  const passed=checks.every(item=>item.passed),flagged=(expect.answer_flags||[]).filter(item=>mentions(answer,item));
  // A completed task whose observable results fail is a false completion.
  const falseCompletion=!passed&&result.state==='review'&&result.reviewStatus==='ready';
  const outcome=!passed?'failed':testCase.manual||flagged.length?'needs_review':'passed';
  return {outcome,passed:outcome==='passed',checks,falseCompletion,...(flagged.length?{flagged}:{})};
}
