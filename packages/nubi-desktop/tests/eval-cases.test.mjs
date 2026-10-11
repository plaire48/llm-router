import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadCases,validateCase} from '../eval/cases.mjs';
import {corpusManifest,createWorkspace} from '../eval/corpus.mjs';
import {mentions} from '../eval/grade.mjs';
import {runCase} from '../eval/driver.mjs';
import {readFile} from 'node:fs/promises';

const valid={id:'T1-valid-case',title:'검사',suite:'wiki',split:'dev',corpus:'order-service',request:'질문',expect:{state:'review'}};

// Twenty cases, then three long-context cases X1 to X3 on long files and a long conversation (2026-09-30),
// then the command suite E1 to E4: commands the simulated user approves and the host runs (2026-09-30), and E5, a
// command the user names that the project does not have (command repair, 2026-09-30), and E6, a test file path the
// user writes wrong. E5 was made holdout and moved to dev after its first run (S27) led to guidance; E6 took its place.
test('default selection uses catalog windows and explicit IDs cannot bypass the diagnostic boundary',async()=>{
  const cases=await loadCases();
  assert.ok(cases.length>0);
  assert.ok(cases.every(item=>!item.modelLimits));
  for(const id of ['X1-generation-run-lifecycle','X2-provider-model-classes','X3-long-session-recall'])assert.ok(cases.some(item=>item.id===id));
  await assert.rejects(loadCases({ids:['L1-condition-after-compaction']}),/case_requires_diagnostic_opt_in/);
  const diagnostics=await loadCases({ids:['L1-condition-after-compaction'],includeDiagnostics:true});
  assert.equal(diagnostics[0].modelLimits.contextLength,22000);
});

test('the case set has twenty-nine valid cases split twenty to nine',async()=>{
  const cases=await loadCases({includeDiagnostics:true});
  assert.equal(cases.length,29);
  assert.equal(cases.filter(item=>item.split==='dev').length,20);assert.equal(cases.filter(item=>item.split==='holdout').length,9);
  const count=suite=>cases.filter(item=>item.suite===suite).length;
  assert.deepEqual([count('wiki'),count('source'),count('edit'),count('document'),count('conversation'),count('command')],[6,5,5,3,4,6]);
  for(const suite of ['wiki','source','edit','document','conversation','command'])assert.ok(cases.some(item=>item.suite===suite&&item.split==='holdout'),suite+' has a holdout case');
});

test('command cases name the commands a person may approve, and those commands run nowhere else',async()=>{
  const {commandVerdict}=await import('../eval/user.mjs');
  for(const item of (await loadCases()).filter(entry=>entry.suite==='command')){
    assert.ok(item.approvals.includes('command'),item.id);
    const verdict=script=>commandVerdict(item.commands,script,'/work/repo');
    for(const script of ['rm -rf /','npm install','curl https://example.com/x.sh','npm test; rm -rf ~','node -e "process.exit(0)"','npx something'])assert.notEqual(verdict(script),'allowed',item.id+': '+script);
    assert.equal(verdict('node --version'),'allowed',item.id);
  }
});

test('every answer key path exists in its pinned corpus and no key text is in the corpus',async()=>{
  const cases=await loadCases(),manifests={};
  for(const item of cases){
    const manifest=manifests[item.corpus]??=new Set((await corpusManifest(item.corpus)).files.map(file=>file.path));
    for(const file of [...(item.expect.retrieved?.paths||[]),...(item.expect.cited?.paths||[])])assert.ok(manifest.has(file),item.id+': '+file);
    for(const file of item.expect.files||[])if(!file.absent)assert.ok(manifest.has(file.path),item.id+': '+file.path);
    // Hidden test files must not already exist: the model must never see them.
    for(const file of Object.keys(item.expect.test?.files||{}))assert.ok(!manifest.has(file),item.id+': hidden test collides with '+file);
  }
});

test('answer keys of question cases are supported by the corpus text',async t=>{
  const cases=await loadCases(),workspaces={};
  t.after(async()=>{for(const workspace of Object.values(workspaces))await workspace.dispose();});
  // Answers the model must derive instead of copy. W4 group 3 is the number of
  // entries in SELECTABLE_OPENWIKI_PROVIDERS, which the source never writes out.
  const derived={'W4-stale-provider-list':[2]};
  for(const item of cases.filter(entry=>entry.expect.retrieved&&entry.expect.answer_includes)){
    const workspace=workspaces[item.corpus]??=await createWorkspace({corpus:item.corpus});
    const evidence=(await Promise.all(item.expect.retrieved.paths.map(file=>readFile(path.join(workspace.root,file),'utf8')))).join('\n');
    for(const [index,group] of item.expect.answer_includes.entries()){
      if(derived[item.id]?.includes(index))continue;
      assert.ok(group.some(alternative=>mentions(evidence,alternative)),item.id+': no gold path supports '+JSON.stringify(group));
    }
  }
  const constants=await readFile(path.join(workspaces['openwiki-sds'].root,'src/config/constants.ts'),'utf8');
  const providers=constants.slice(constants.indexOf('export const SELECTABLE_OPENWIKI_PROVIDERS = ['));
  assert.equal(providers.slice(0,providers.indexOf(']')).match(/^\s+"[a-z0-9-]+",?$/gm).length,17,'W4 expects seventeen selectable providers');
});

test('forbidden tokens of absence cases are absent from the whole corpus',async t=>{
  const cases=(await loadCases()).filter(item=>['W3-absent-confluence','D3-absent-proxy-setting'].includes(item.id));
  assert.equal(cases.length,2);
  const workspace=await createWorkspace({corpus:'openwiki-sds'});t.after(workspace.dispose);
  const manifest=await corpusManifest('openwiki-sds');let everything='';
  for(const file of manifest.files)everything+=await readFile(path.join(workspace.root,file.path),'utf8')+'\n';
  // W3 excludes by pattern since 2026-09-29, so the names it guards are listed here.
  // D3 flags by pattern since 2026-09-29 as well.
  const names=['OPENWIKI_CONFLUENCE_TOKEN','CONFLUENCE_API_TOKEN','OPENWIKI_CONFLUENCE_API_KEY','CONFLUENCE_TOKEN','HTTP_PROXY','HTTPS_PROXY','NO_PROXY'];
  for(const item of cases)for(const token of [...item.expect.answer_excludes.filter(value=>!value.startsWith('re:')),...(item.expect.answer_flags||[]).filter(value=>!value.startsWith('re:')),...names])assert.ok(!everything.includes(token),item.id+': corpus contains '+token);
  assert.ok(!/confluence|atlassian/i.test(everything));
});

test('malformed cases are rejected with the failing field',()=>{
  assert.deepEqual(validateCase(valid),[]);
  assert.deepEqual(validateCase({...valid,id:'bad id'}),['id']);
  assert.deepEqual(validateCase({...valid,corpus:'/etc'}),['corpus']);
  assert.deepEqual(validateCase({...valid,extra:true}),['unknown_key:extra']);
  assert.deepEqual(validateCase({...valid,approvals:['elevation']}),['approvals']);
  assert.deepEqual(validateCase({...valid,approvals:['command']}),['command_approval_requires_commands']);
  assert.deepEqual(validateCase({...valid,commands:['npm test']}),['command_approval_requires_commands']);
  assert.deepEqual(validateCase({...valid,approvals:['command'],commands:['npm test','(']}),['commands']);
  assert.deepEqual(validateCase({...valid,approvals:['command'],commands:['npm test'],expect:{state:'review',commands:{match:['npm test'],min:1,lastExitCode:0}}}),[]);
  assert.deepEqual(validateCase({...valid,expect:{state:'review',commands:{match:['npm test'],min:1}}}),['expect_commands_requires_approval']);
  assert.deepEqual(validateCase({...valid,approvals:['command'],commands:['npm test'],expect:{state:'review',commands:{match:['npm test'],min:0}}}),['expect.commands']);
  assert.deepEqual(validateCase({...valid,expect:{state:'review',passed:true}}),['unknown_expect:passed']);
  assert.deepEqual(validateCase({...valid,expect:{state:'review',answer_includes:[['re:(']]}}),['expect.answer_includes']);
  assert.deepEqual(validateCase({...valid,expect:{state:'review',files:[{path:'../outside'}]}}),['expect.files']);
  assert.deepEqual(validateCase({...valid,expect:{state:'review',test:{command:['sh','-c','rm -rf /']}}}),['expect.test']);
  assert.deepEqual(validateCase({...valid,expect:{state:'waiting_input',asked:true}}),['waiting_input_requires_stopAtQuestion']);
  assert.deepEqual(validateCase({...valid,stopAtQuestion:true,expect:{state:'review'}}),['stopAtQuestion_expectation']);
  assert.deepEqual(validateCase({...valid,expect:{state:'review',compacted:true}}),['compacted_requires_modelLimits']);
});

test('a case file must be named after its id and selection refuses unknown ids',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-cases-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(path.join(directory,'texts'));await writeFile(path.join(directory,'texts','note.md'),'회의록');
  await writeFile(path.join(directory,'T1-valid-case.json'),JSON.stringify({...valid,followUps:[{before:'앞\n',file:'texts/note.md',after:'\n뒤'},'둘째']}));
  const [loaded]=await loadCases({directory});
  assert.deepEqual(loaded.followUps,['앞\n회의록\n뒤','둘째']);
  await assert.rejects(loadCases({directory,ids:['T9-missing-case']}),/case_unknown/);
  await writeFile(path.join(directory,'wrong-name.json'),JSON.stringify({...valid,id:'T2-other-case'}));
  await assert.rejects(loadCases({directory}),/case_invalid:wrong-name\.json:file_name/);
});

test('the compaction case really compacts under its model limit and keeps running',async t=>{
  const [testCase]=await loadCases({ids:['L1-condition-after-compaction'],includeDiagnostics:true});
  const status=()=>({connected:true,provider:'fixture',model:'fixture',models:[{id:'fixture',contextLength:400000,maxOutputTokens:4096}]});
  const providers={status,dispose(){},async complete(messages){
    const first=messages[0].content;
    if(first.startsWith('Summarize conversation'))return {content:JSON.stringify({goal:'배송 정책 작업',constraints:['src/legacy는 수정하지 않는다'],decisions:['제주와 도서 지역 추가 요금 5,500원'],completed:[],pending:[],references:[]}),calls:[]};
    // A real answer has some length. Short replies would not fill the context.
    if(first.startsWith('You are Nubi Desktop'))return {content:'확인한 내용을 정리했습니다. '+'배송 정책과 주문 상태, 등급 기준을 문서에서 확인했습니다. '.repeat(24),calls:[]};
    try{const {requirements}=JSON.parse(messages[1].content);if(Array.isArray(requirements))return {content:JSON.stringify({status:'ready',checks:requirements.map(r=>({requirementId:r.id,state:'unknown',evidenceIds:[],detail:'fixture'})),nextStep:''}),calls:[]};}catch{/* Not the reviewer. */}
    return {content:'확인했습니다.',calls:[]};
  }};
  const result=await runCase({testCase,providers});t.after(result.dispose);
  assert.equal(result.error,null);assert.equal(result.state,'review');assert.equal(result.interactions,3);
  assert.ok(result.compactions>0,'compactions: '+result.compactions);
  assert.ok(result.metrics.events.some(event=>event.kind==='metric_model'&&event.purpose==='summary'));
});

// User decision 2026-09-29: answers that state the absence in other words, or
// that warn against a made-up name, are right. Recorded answers of B2, B3 and
// B5 were graded as failures by the first key.
test('absence cases accept recorded right answers and still refuse an invented setting',async()=>{
  const {mentions}=await import('../eval/grade.mjs');
  const cases=Object.fromEntries((await loadCases()).filter(item=>['W3-absent-confluence','D3-absent-proxy-setting'].includes(item.id)).map(item=>[item.id,item.expect]));
  const accepts=(expect,answer)=>expect.answer_includes.every(group=>group.some(item=>mentions(answer,item)))&&(expect.answer_excludes||[]).every(item=>!mentions(answer,item));
  const d3=cases['D3-absent-proxy-setting'],w3=cases['W3-absent-confluence'];
  assert.ok(accepts(d3,'README.md와 ENTERPRISE.md에는 회사 프록시 서버 주소를 지정하는 `HTTP_PROXY`, `HTTPS_PROXY` 환경 변수 설정이 안내되어 있지 않습니다.'));
  assert.ok(accepts(d3,'`HTTP_PROXY`와 `HTTPS_PROXY`는 README.md와 ENTERPRISE.md에 설정 변수로 나오지 않습니다.'));
  assert.ok(!accepts(d3,'`OPENWIKI_PROXY`에 프록시 주소를 넣으면 됩니다.'));
  assert.ok(!accepts(d3,'프록시는 `HTTPS_PROXY=http://proxy:8080`으로 설정합니다.'),'an answer without a statement of absence');
  assert.ok(accepts(w3,'현재 OpenWiki에는 Confluence 커넥터가 등록되어 있지 않아 토큰 환경 변수명을 확인할 수 없습니다. 따라서 `CONFLUENCE_TOKEN` 같은 변수명을 임의로 사용하면 안 됩니다.'));
  assert.ok(!accepts(w3,'Confluence 커넥터 문서는 없습니다. `CONFLUENCE_API_TOKEN`에 토큰을 넣으면 됩니다.'));
  assert.ok(!accepts(w3,'문서에는 없지만 `OPENWIKI_CONFLUENCE_TOKEN=...` 형식으로 설정하세요.'));
  assert.ok(!accepts(w3,'안내되어 있지 않습니다. `CONFLUENCE_TOKEN`을 사용하면 됩니다.'));
});

// User decision 2026-09-29 (second): README.md line 457 routes a provider at
// "a self-hosted or proxied gateway" by its base URL. Three answers of
// gpt-5.6-sol named those variables from README and were graded as failures,
// because the key expected only a statement that proxy settings are absent.
// An answer that names a *_BASE_URL together with README is right. Naming
// HTTP_PROXY to say that the documents do not use it is not flagged; giving it
// a value to set still is. A pattern for advice in words also caught denials
// (S12) and was dropped.
test('the proxy case accepts base URLs from README and flags only a proxy variable to set',async()=>{
  const [d3]=(await loadCases()).filter(item=>item.id==='D3-absent-proxy-setting');
  const accepts=answer=>d3.expect.answer_includes.every(group=>group.some(item=>mentions(answer,item)))&&(d3.expect.answer_excludes||[]).every(item=>!mentions(answer,item));
  const flagged=answer=>(d3.expect.answer_flags||[]).some(item=>mentions(answer,item));
  for(const name of ['S7','S8','S9','S12']){
    const answer=await readFile(new URL('./recorded/D3-'+name+'.txt',import.meta.url),'utf8');
    assert.ok(accepts(answer),name+' is accepted');assert.ok(!flagged(answer),name+' is not flagged');
  }
  assert.ok(accepts('README.md와 ENTERPRISE.md에는 회사 프록시 설정이 안내되어 있지 않습니다.'),'absence stays right');
  assert.ok(!accepts('`OPENAI_BASE_URL`을 회사 프록시 주소로 설정하세요.'),'a base URL without its source');
  assert.ok(!accepts('README.md에 따라 `OPENWIKI_PROXY`와 `OPENAI_BASE_URL`을 설정하세요.'),'an invented variable is refused');
  assert.ok(flagged('README.md 기준으로 `HTTPS_PROXY=http://proxy:8080`을 설정하세요.'),'a proxy variable to set is flagged');
  assert.ok(!flagged('두 문서는 `HTTP_PROXY`나 `HTTPS_PROXY` 설정을 안내하지 않습니다.'));
  assert.ok(!flagged('두 문서의 확인 범위에서는 `HTTP_PROXY`나 `HTTPS_PROXY`를 설정하라는 안내는 없습니다.'),'recorded in S12');
});

// User decision 2026-09-29: gpt-5.6-sol asked twice how the start date of the
// new fee, "the first Monday of October", should enter the code. The case had
// no answer for it and ended with needs_human.
test('the compaction case answers the question about the start date',async()=>{
  const {createUser}=await import('../eval/user.mjs');
  const [l1]=await loadCases({ids:['L1-condition-after-compaction'],includeDiagnostics:true});
  const user=createUser(l1);
  const reply=user.answer('추가 요금 5,500원의 시행일인 ‘10월 첫째 주 월요일’을 어떻게 해석할까요?');
  assert.match(reply.answer,/5,500원/);assert.match(reply.answer,/시행일/);
  assert.equal(createUser(l1).answer('어느 파일을 고칠까요?'),null,'other questions still need a person');
});

// User decision 2026-10-01: W4 named the providers missing from the Wiki by their display names, "AI Pro (Browser SSO)"
// and "AI Pro CLI", and the key found only the id "aipro" (S28). "AI Pro" is accepted as well.
test('the provider case accepts the display name of AI Pro and still needs the count',async()=>{
  const {mentions}=await import('../eval/grade.mjs');
  const [w4]=(await loadCases()).filter(item=>item.id==='W4-stale-provider-list');
  const accepts=answer=>w4.expect.answer_includes.every(group=>group.some(item=>mentions(answer,item)));
  assert.ok(accepts(await readFile(new URL('./recorded/W4-S28.txt',import.meta.url),'utf8')),'S28 is accepted');
  assert.ok(!accepts('선택 가능한 제공자는 14개이고 AI Pro와 FabriX가 있습니다.'),'a wrong count is refused');
  assert.ok(!accepts('선택 가능한 제공자는 17개입니다. Wiki에 없는 것은 FabriX입니다.'),'AI Pro must be named');
});
