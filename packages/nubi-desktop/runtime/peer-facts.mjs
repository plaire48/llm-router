// Facts a run of a request another Nubi sent reports before its answer (A2A, user decision 2026-10-01). As in the
// browser (extensions/aipro-chat/delegation-facts.js), each names where it was read and that source's own words; here
// the source is a project file. A fact counts as checked only when a read of this run, of that path, holds the quote.
// The shared runtime checks a call named report_facts against web pages, so this host's tool has its own name.
export const REPORT_FACTS_TOOL={type:'function',function:{name:'report_source_facts',
  description:'Report the facts you found for the Nubi that requested this task, before your final answer. Give each fact the project path you read it in and the exact words from that file. Facts are checked against files read in this run; an unmatched quote is sent as unchecked. Calling again replaces the earlier list.',
  parameters:{type:'object',properties:{facts:{type:'array',minItems:1,maxItems:50,items:{type:'object',properties:{
    name:{type:'string',minLength:1,maxLength:200,description:'What the fact is, e.g. a requested item name.'},
    value:{type:'string',minLength:1,maxLength:4000},
    path:{type:'string',minLength:1,maxLength:500,description:'Project path of the file the fact was read in.'},
    quote:{type:'string',minLength:2,maxLength:1000,description:'Exact text from that file supporting the value.'}},
  required:['name','value','path','quote'],additionalProperties:false}}},required:['facts'],additionalProperties:false}}};

// Markdown marks and spacing differ between a source and a quote of it, so both sides are compared without them.
const plain=value=>String(value||'').normalize('NFC').replace(/[*_`#>|[\]()!\\\s]/g,'').toLowerCase();
const relative=value=>String(value||'').replaceAll('\\','/').replace(/^\.\//,'');
const HASH=/^sha256:[a-f0-9]{64}$/;

// The project text this run read: source ranges and Wiki excerpts, each with the version of the file it came from.
export function readFiles(evidence){
  const files=[];
  for(const item of Array.isArray(evidence)?evidence:[]){
    const result=item?.result;
    if(item?.tool==='read_source'&&typeof result?.path==='string'&&typeof result.content==='string')files.push({path:relative(result.path),hash:result.hash,text:plain(result.content)});
    else if(item?.tool==='wiki_query')for(const row of Array.isArray(result?.results)?result.results:[])if(typeof row?.path==='string'&&typeof row.excerpt==='string')files.push({path:relative(row.path),hash:row.hash,text:plain(row.excerpt)});
  }
  return files;
}

export function checkReportedFacts(args,evidence){
  const facts=args?.facts;
  if(!Array.isArray(facts)||!facts.length||facts.length>50)return {error:'tool_arguments_invalid'};
  const files=readFiles(evidence),checked=[];
  const text=(value,max,min=1)=>typeof value==='string'&&value.trim().length>=min&&value.length<=max;
  for(const fact of facts){
    if(!text(fact?.name,200)||!text(fact.value,4000)||!text(fact.quote,1000,2)||!text(fact.path,500))return {error:'tool_arguments_invalid'};
    const path=relative(fact.path.trim()),quote=plain(fact.quote),file=quote.length>=2&&files.find(item=>item.path===path&&item.text.includes(quote));
    checked.push({name:fact.name.trim(),value:fact.value.trim(),path,quote:fact.quote.trim(),checked:!!file,...(file&&HASH.test(file.hash||'')?{hash:file.hash}:{})});
  }
  return {facts:checked};
}

// The facts of a delivered result (nubi-task-v1). host_checked needs the run's own final review, which delivery already
// requires, and every reported quote found in a file the run read.
export function deliveredFacts(reported){
  const facts=(Array.isArray(reported)?reported:[]).slice(0,50);
  return {facts:facts.map(({name,value,path,quote,hash})=>({name,value,path,quote,...(hash?{hash}:{})})),verification:facts.length&&facts.every(fact=>fact.checked&&fact.hash)?'host_checked':'not_run'};
}
