import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {ORIGIN,DEFAULT_SETTINGS} from '../core.js';
import {readCompletion} from '../completion-reader.js';
import {wikiQualityDataset} from '../tests/fixtures/wiki-quality-corpus.mjs';
import {runWikiQualityCases} from './wiki-model-evaluation.mjs';
import {textHash} from './wiki-quality-evaluation.mjs';

process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const directory=`verification/wiki-live-${new Date().toISOString().replace(/[:.]/g,'-')}`;
await mkdir(directory,{recursive:true});
const output=`${directory}/report.json`,dataset=wikiQualityDataset();
let verifiedResponses=0,previousResponses=0;
const report={datasetVersion:dataset.version,datasetSha256:textHash(JSON.stringify(dataset)),kind:'wiki-core-condition-comparison',status:'not_configured',actualModel:false,actualBrowser:false,modelCapabilityScore:null,semanticFaithfulness:null,cases:[]};
const persist=()=>writeFile(output,JSON.stringify({...report,verifiedResponses},null,2)+'\n');
if(!process.env.NUBI_EVAL_TOKEN) {
  await persist();console.log(`NOT RUN: configure NUBI_EVAL_TOKEN locally. ${output}`);process.exitCode=2;
} else {
  const modelId=process.env.NUBI_EVAL_MODEL||DEFAULT_SETTINGS.modelId;
  const complete=async(messages,tools,{signal})=>{
    const response=await fetch(`${ORIGIN}/api/v1/chat/completions`,{method:'POST',redirect:'error',signal,
      headers:{'Content-Type':'application/json',Accept:'text/event-stream',Authorization:`Bearer ${process.env.NUBI_EVAL_TOKEN}`},
      body:JSON.stringify({model:modelId,messages,max_tokens:4096,stream:true,...(tools.length?{tools,tool_choice:'auto'}:{})})});
    let calls=[],finishReason;
    const content=await readCompletion(response,undefined,undefined,undefined,value=>{finishReason=value;},value=>{calls=value;});
    verifiedResponses++;return {content,calls,finishReason};
  };
  try {
    report.status='running';report.model=modelId;await persist();
    const result=await runWikiQualityCases(dataset,{complete,modelId,repeats:process.env.NUBI_EVAL_REPEATS?Number(process.env.NUBI_EVAL_REPEATS):3,onCase:async record=>{record.verifiedResponses=verifiedResponses-previousResponses;previousResponses=verifiedResponses;report.cases.push(record);report.actualModel=verifiedResponses>0;await persist();}});
    Object.assign(report,result,{actualModel:verifiedResponses>0,status:result.cases.every(row=>row.grade.passed)?'passed':'failed'});
    process.exitCode=report.status==='passed'?0:1;
  } catch {report.status='failed';report.reason='Evaluation interrupted or setup invalid; no complete comparison is available.';process.exitCode=1;}
  finally {report.actualModel=verifiedResponses>0;await persist();console.log(output);}
}
