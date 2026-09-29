import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {mkdtemp,cp,appendFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {wikiBrowserBuild} from '../scripts/wiki-browser-build.mjs';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-wiki-agent-')), extension=resolve(profile,'extension');
let context;
try {
  await cp(resolve('dist'),extension,{recursive:true});
  await build({stdin:{contents:"export {runAgent} from './agent-runtime.js'; export {openWikiTools} from './openwiki-contract.js'; export {createQuestionCorpus} from '../../packages/openwiki/src/agent/wiki-question.ts'; export {createWikiQuestionSearch} from './openwiki-retrieval.js';",resolveDir:process.cwd()},outfile:resolve(extension,'wiki-probe.js'),bundle:true,platform:'browser',format:'esm',target:'chrome125',
    ...wikiBrowserBuild});
  await appendFile(resolve(extension,'background.js'),"\nimport {runAgent as wikiProbeRun,openWikiTools as wikiProbeTools,createQuestionCorpus,createWikiQuestionSearch} from './wiki-probe.js';globalThis.wikiProbe={run:wikiProbeRun,tools:wikiProbeTools,createQuestionCorpus,createWikiQuestionSearch};\n");
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY || chromium.executablePath(),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const errors=[]; const debug=await context.newPage(); debug.on('pageerror',error=>errors.push(error.message));
  await debug.goto(worker.url().replace(/background\.js$/, 'index.html'));
  assert.equal(await debug.evaluate(async()=>{try {await import('./wiki-probe.js');return 'ok';} catch(e) {return e.stack;}}),'ok');
  await new Promise(resolve=>setTimeout(resolve,500));
  assert.equal(await worker.evaluate(()=>typeof wikiProbe),'object');
  assert.deepEqual(errors,[]);
  const result=await worker.evaluate(async()=>{
    const traces=[], childCalls=[], reports=[], reads=[];
    const authChecks=[];
    for(const auth of [{wiki:'internal',message:'unauthorized',status:401},{wiki:'external',message:'forbidden'}]) {
      const parent=new AbortController();let mainCalls=0,researchCalls=0,sourceReads=0,peerAborted=false,releasePeer,timer;
      const peerStarted=new Promise(resolve=>{releasePeer=resolve;});
      let failure;
      try {
        await wikiProbe.run({modelId:'chosen',signal:parent.signal,messages:[{role:'user',content:'Read every Wiki document'}],tools:wikiProbe.tools({internal:true,external:true}),
          execute:async()=>{sourceReads++;return {wikiId:`${auth.wiki}:auth-test`,sourceComplete:true,documents:Array.from({length:6},(_,i)=>({id:`doc-${i}`,kind:auth.wiki==='internal'?'site':'folder',path:`doc-${i}.md`,title:'Policy',text:'Source policy'}))};},
          complete:async()=>{mainCalls++;return mainCalls===1?{content:'',calls:[{id:'wiki-auth',function:{name:'ask_openwiki',arguments:JSON.stringify({wiki:auth.wiki,question:'Read all policies'})}}]}:{content:'Unexpected model round'};},
          completeAnalysis:async(messages,_tools,scope)=>{
            if(messages.some(m=>m.role==='system' && m.content.includes('Plan OpenWiki research')))return {content:JSON.stringify({mode:'comprehensive',questions:['Read all']})};
            researchCalls++;
            if(researchCalls===1){await peerStarted;throw Object.assign(new Error(auth.message),auth.status?{status:auth.status}:{});}
            releasePeer();
            return new Promise((resolve,reject)=>{
              const abort=()=>{peerAborted=true;clearTimeout(timer);reject(new Error('cancelled'));};
              scope.signal.addEventListener('abort',abort,{once:true});if(scope.signal.aborted)return abort();
              timer=setTimeout(()=>{scope.signal.removeEventListener('abort',abort);resolve({content:JSON.stringify({status:'blocked',answer:'No result',findings:[],uncertainties:['Pending']})});},1000);
            });
          },
        });
      } catch(error) {failure={message:error.message,status:error.status};}
      finally {clearTimeout(timer);}
      if(failure?.message!==auth.message || failure.status!==auth.status || mainCalls!==1 || researchCalls!==2 || sourceReads!==1 || !peerAborted || parent.signal.aborted)throw Error('Wiki authentication did not stop at its scope');
      authChecks.push({wiki:auth.wiki,error:failure,mainCalls,researchCalls,sourceReads,peerAborted,parentCancelled:parent.signal.aborted});
    }
    const table='# 비용 기준\n\n| 항목 | 금액 (원/일) |\n| --- | --- |\n'+'| 일반 | 100 |\n'.repeat(1000)+'| 특별지역 | 270 |\n';
    const corpus=await wikiProbe.createQuestionCorpus([{id:'table',kind:'folder',path:'table.md',title:'비용',text:table}],wikiProbe.createWikiQuestionSearch());
    const observed=new Set(),sourceTools=corpus.tools({documentIds:['table'],question:'특별지역'},observed);
    const candidates=JSON.parse(await sourceTools[0].invoke({query:'특별지역'}));
    const header=candidates[0].contextRanges.find(item=>item.kind==='table_header');
    if(!header || observed.size || candidates[0].start<6000)throw Error('Lost structural context');
    const headerEvidence=await sourceTools[1].invoke({documentId:'table',start:header.start,length:header.end-header.start});
    const structuralContext=headerEvidence.excerpt.includes('원/일') && observed.has(headerEvidence.id);
    const lateSeen=new Set();
    const late=corpus.read('table',candidates[0].start,6000,{documentIds:['table'],question:'특별지역',range:{documentId:'table',start:candidates[0].start,end:table.length}},lateSeen);
    const supplied=late.contextEvidence.find(item=>item.contextKind==='table_header');
    const boundaryContext=Boolean(supplied?.excerpt.includes('원/일') && supplied.hash===late.hash && lateSeen.has(supplied.id) &&
      late.contextEvidence.reduce((n,e)=>n+e.excerpt.length,0)<=600);


    const report=ids=>({status:'complete',answer:'근거를 확인했습니다.',findings:[{text:'각 위키의 규칙입니다.',citations:ids.slice(0,3)}],uncertainties:[]});
    let turn=0,researchSearches=0,synthesisSearches=0,planRepairs=0;
    await wikiProbe.run({modelId:'QWEN3.8-27B-FP8-256K',signal:new AbortController().signal,messages:[{role:'user',content:'두 위키의 업무 규칙을 비교해줘'}],tools:wikiProbe.tools({internal:true,external:true}),onStep:event=>traces.push(event),
      execute:async(name,args)=>{
        if(name!=='ask_openwiki')throw new Error('Unexpected host tool'); reads.push(args.wiki);
        return {wikiId:`${args.wiki}:fixture`,sourceComplete:true,documents:[{id:'doc',kind:args.wiki==='internal'?'site':'folder',path:args.wiki==='internal'?'https://portal.example/a':'guide.md',title:'정책',text:args.wiki==='internal'?'INTERNAL_ONLY':'EXTERNAL_ONLY\n'.repeat(4200)}]};
      },
      complete:async messages=>{
        const previous=messages.filter(m=>m.role==='tool').at(-1); if(previous) reports.push(JSON.parse(previous.content));
        if(++turn<=2)return {content:'',calls:[{id:`main-${turn}`,type:'function',function:{name:'ask_openwiki',arguments:JSON.stringify({wiki:turn===1?'internal':'external',question:'업무 규칙은?'})}}]};
        return {content:'두 위키의 근거를 각각 확인했습니다.'};
      },
      completeAnalysis:async(messages,tools,scope)=>{
        childCalls.push({messages,modelId:scope.modelId,tools:tools.map(t=>t.function.name)});
        const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),last=messages.at(-1);
        if(system.includes('Plan OpenWiki research')) {
          const data=JSON.parse(last.content),large=data.catalog.some(d=>d.characters>24000);
          if(tools.length)throw Error('Planner tools must stay empty');
          if(!data.formatRepair)return {content:large?' {"mode":"comprehensive","questions":[]}':'{"mode":'};
          if(data.question!=='업무 규칙은?')throw Error('Lost original question');
          planRepairs++;
          return {content:JSON.stringify({mode:large?'comprehensive':'focused',questions:['업무 규칙 확인']})};
        }
        if(system.includes('Synthesize')) {
          if(last.role==='user')return {content:'',calls:[{id:'archive-search',function:{name:'search_wiki',arguments:JSON.stringify({query:'각 위키 규칙'})}}]};
          const hits=JSON.parse(last.content);if(!hits.length || !hits[0].citations?.length)throw Error('Lost synthesis search output');
          synthesisSearches++;return {content:JSON.stringify(report(hits.flatMap(hit=>hit.citations)))};
        }
        if(last.role==='user')return {content:'',calls:[{id:'source-search',function:{name:'search_wiki',arguments:JSON.stringify({query:JSON.parse(messages.find(m=>m.role==='user').content).catalog[0].characters>24000?'EXTERNAL_ONLY':'INTERNAL_ONLY'})}}]};
        if(last.tool_call_id==='source-search') {
          const hits=JSON.parse(last.content);if(!hits.length || hits[0].documentId!=='doc')throw Error('Lost research search output');
          researchSearches++;
        }
        if(last.role==='tool' && last.tool_call_id!=='source-search')return {content:JSON.stringify(report([JSON.parse(last.content).id]))};
        return {content:'',calls:[{id:'read',type:'function',function:{name:'read_wiki',arguments:JSON.stringify({documentId:'doc',start:JSON.parse(messages.find(m=>m.role==='user').content).assignment.range?.start || 0,length:6000})}}]};
      },
    });
    return {authChecks,planRepairs,researchSearches,synthesisSearches,boundaryContext,structuralContext,reports,reads,calls:childCalls.length,isolated:childCalls.every(c=>!(JSON.stringify(c.messages).includes('INTERNAL_ONLY')&&JSON.stringify(c.messages).includes('EXTERNAL_ONLY'))),
      model:childCalls.every(c=>c.modelId==='QWEN3.8-27B-FP8-256K'),readonly:childCalls.every(c=>c.tools.every(t=>['read_wiki','search_wiki'].includes(t))),trace:traces.some(t=>t.analysis?.delivered),workerOnly:typeof document==='undefined'};
  });
  assert.equal(result.reports.length,2); assert(result.reports[1].coverage.repairTasks>0); assert.deepEqual(result.reports[1].coverage.unreadRanges,[]); assert(result.reports.every(r=>r.engine==='openwiki-deepagents' && r.status==='complete'));
  assert(result.structuralContext && result.boundaryContext);
  assert(result.researchSearches>0 && result.synthesisSearches>0);
  assert.equal(result.planRepairs,2);assert.equal(result.authChecks.length,2);
  assert(result.isolated && result.model && result.readonly && result.trace && result.workerOnly);
  assert.deepEqual(result.reads,['internal','internal','external','external']);
  await writeFile('verification/openwiki-agent-browser.json',JSON.stringify({status:'passed',realModel:false,browser:context.browser().version(),...result},null,2));
  console.log(JSON.stringify({status:'passed',authChecks:result.authChecks,researchSearches:result.researchSearches,synthesisSearches:result.synthesisSearches,boundaryContext:result.boundaryContext,structuralContext:result.structuralContext,calls:result.calls,internalExternalIsolated:result.isolated,sameModel:result.model,readonly:result.readonly}));
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}
