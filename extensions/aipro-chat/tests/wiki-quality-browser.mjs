import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {mkdtemp, cp, appendFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {wikiQualityDataset} from './fixtures/wiki-quality-corpus.mjs';
import {gradeWikiRetrieval, textHash} from '../scripts/wiki-quality-evaluation.mjs';
import {wikiBrowserBuild} from '../scripts/wiki-browser-build.mjs';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-wiki-quality-')), extension=resolve(profile,'extension');
let context;
try {
  await cp(resolve('dist'),extension,{recursive:true});
  await build({stdin:{contents:"export {createWikiQuestionSearch} from './openwiki-retrieval.js';",resolveDir:process.cwd()},outfile:resolve(extension,'quality-probe.js'),bundle:true,platform:'browser',format:'esm',target:'chrome125',...wikiBrowserBuild});
  await appendFile(resolve(extension,'background.js'),"\nimport {createWikiQuestionSearch as qualityProbeSearch} from './quality-probe.js';globalThis.qualitySearch=qualityProbeSearch;\n");
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{const until=Date.now()+10000;while(typeof globalThis.qualitySearch!=='function'){if(Date.now()>until)throw Error('Wiki probe initialization failed');await new Promise(resolve=>setTimeout(resolve,25));}});
  const dataset=wikiQualityDataset(), cases=[];
  for(const task of dataset.cases) {
    // The worker receives no reference answers or gold ranges.
    const hits=await worker.evaluate(({question,documents})=>globalThis.qualitySearch()(question,documents),{question:task.question,documents:task.snapshot.documents});
    const grade=gradeWikiRetrieval(task,hits);
    assert.notEqual(grade.passed,false,JSON.stringify({id:task.id,grade}));
    cases.push({id:task.id,...grade});
  }
  await writeFile('verification/wiki-quality-browser.json',JSON.stringify({status:'passed',datasetVersion:dataset.version,datasetSha256:textHash(JSON.stringify(dataset)),browser:context.browser().version(),actualModel:false,cases},null,2));
  console.log('PASS Korean Wiki retrieval corpus in MV3; semantic/model accuracy remains unmeasured');
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}
