import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {verificationTextFeedback} from '../verification-text-feedback.js';
import {parse} from 'acorn';
import {browserURL, sourceURL, compareBrowserURL, compareLinkURL, comparePageURL, URL_VERIFICATION_GUIDE, LINK_VERIFICATION_GUIDE} from '../browser-url.js';
import {refreshBrowserPolicy} from '../browser-policy.js';
globalThis.chrome={storage:{managed:{get:async()=>({})}}};
await refreshBrowserPolicy();
import {verificationDiagnostic} from '../completion-errors.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

// Execute the real target binding and verifier functions. Only transport,
// DOM inspection and time are stubbed; no browser/action or fixture verdicts.
const source=await readFile(new URL('../browser-agent.js',import.meta.url),'utf8');
const functions=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.type==='FunctionDeclaration'&&['target','verifyObservedLink','verifyPage'].includes(n.id.name)).map(n=>source.slice(n.start,n.end)).join('\n');
function fixture({href='https://example.test/article?id=1#section',fault,child=false,contentRef=false}={}) {
  const document={}, changedDocument={};let ticks=0,hrefReads=0,scopeReads=0,inspectReads=0,binds=0;
  const descriptor={kind:'link',tag:'a',name:'Observed article',role:'link',type:''};
  const node={tagName:fault==='non_anchor'?'BUTTON':'A',hasAttribute:name=>name==='href'&&fault!=='no_href',isConnected:fault!=='removed',ownerDocument:fault==='adopted_other_frame'?changedDocument:document,
    get href(){hrefReads++;return fault==='href_race'&&hrefReads>1?'https://example.test/changed':href;}};
  const frame={url:()=>child?'https://frame.test/embed':'https://search.test/results',isDetached:()=>fault==='detached'};
  const handle={evaluate:async(fn,arg)=>fn(node,arg)};
  const latestObservation={tabId:7,topDocumentId:'top-doc',frames:[{frame:child?1:0,documentId:child?'child-doc':'top-doc',elements:[{ref:'observed',...descriptor}]}]};
  if(fault==='missing_document')delete latestObservation.topDocumentId;
  const entry={handle,frame,descriptor,...(fault==='wrong_document'?{documentId:'other-doc'}:contentRef?{documentId:child?'child-doc':'top-doc'}:{})};
  const task={tabId:7,app:true,latestObservation,refs:new Map(fault==='missing_ref'?[]:[['observed',entry]]),page:{url:()=> 'https://search.test/results',frames:()=>[]}};
  const inspectTarget=()=>{inspectReads++;return {name:fault==='name_changed'?'Other article':fault==='empty_name'?'':'Observed article',role:fault==='role_changed'?'button':'link',type:'',connected:fault!=='removed',secret:fault==='secret',hidden:fault==='hidden'};};
  if(fault==='descriptor_non_anchor')descriptor.kind='control';
  const context=vm.createContext({verificationTextFeedback,document,browserURL,compareBrowserURL,compareLinkURL,comparePageURL,URL_VERIFICATION_GUIDE,LINK_VERIFICATION_GUIDE,safeURL:sourceURL,inspectTarget,
    MAX_PAGE_CHECKS:20,MAX_FIELD_VALUE_CHARS:16000,validSumCheck:()=>false,validEditorFormat:()=>false,active:task,
    bindObservedRef:async()=>{binds++;if(fault==='wrong_document')throw Error('browser_stale');return entry;},
    observedDocumentScope:async()=>{scopeReads++;return [{frameId:0,documentId:fault==='top_changed'||fault==='scope_race'&&scopeReads>1?'other-top':'top-doc',result:{url:'https://search.test/results'}},...(child?[{frameId:4,documentId:fault==='frame_changed'?'new-child':'child-doc',result:{url:frame.url()}}]:[])];},
    observe:async()=>latestObservation,delay:async ms=>{ticks+=ms;},Date:{now:()=>ticks},testTask:task,
  });
  vm.runInContext(functions+'\nglobalThis.host={check:check=>verifyObservedLink(testTask,check),verify:checks=>verifyPage(testTask,checks,250)};',context);
  return {host:context.host,task,counts:()=>({hrefReads,scopeReads,inspectReads,binds})};
}
const link=(expected='https://example.test/article?id=1#section',ref='observed')=>({kind:'link_destination',ref,expected});
const plain=value=>JSON.parse(JSON.stringify(value));

test('observed anchor destination differs from current page URL and exact check never returns the href',async()=>{
  for(const [child,contentRef] of [[false,false],[true,false],[false,true],[true,true]]){
    const f=fixture({child,contentRef});assert.deepEqual(plain(await f.host.check(link())),{passed:true});
    const result=await f.host.verify([link()]);assert.equal(result.verified,true);assert.equal(result.checks[0].kind,'link_destination');
    assert(!JSON.stringify(result.checks).includes('example.test'));assert(!JSON.stringify(result.checks).includes('id=1'));
    assert(f.counts().scopeReads>=2);assert(f.counts().inspectReads>=2);if(contentRef)assert(f.counts().binds>=1);
  }
  const f=fixture();const result=await f.host.verify([{kind:'url_is',expected:link().expected}]);assert.equal(result.verified,false);assert.equal(result.checks[0].reason,'url_origin_mismatch');
});

test('different destination origin, resource path, query and fragment cannot pass through redacted equality',async()=>{
  const cases=[['https://other.test/article?id=1#section','url_origin_mismatch'],['https://example.test/other?id=1#section','url_path_mismatch'],['https://example.test/article?id=2#section','url_query_mismatch'],['https://example.test/article?id=1#other','url_fragment_mismatch']];
  for(const[expected,reason]of cases){const result=await fixture().host.check(link(expected));assert.equal(result.passed,false);assert.equal(result.reason,reason);assert(!JSON.stringify(result).includes(expected));}
  for(const href of ['javascript:alert(1)','https://user:secret@example.test/article','https://auth.openai.com/login']){const result=await fixture({href}).host.check(link());assert.equal(result.passed,false);assert.match(result.reason,/url_actual_(invalid|restricted)/);assert(!JSON.stringify(result).includes('secret'));}
});

test('removed, renamed, hidden, secret, adopted or document/frame changed anchors are rejected',async()=>{
  for(const fault of ['missing_document','missing_ref','removed','detached','name_changed','empty_name','role_changed','secret','hidden','adopted_other_frame','wrong_document','top_changed','scope_race','href_race']){
    const result=await fixture({fault}).host.check(link());assert.equal(result.passed,false,fault);assert.equal(result.reason,'target_changed',fault);
  }
  assert.equal((await fixture({child:true,fault:'frame_changed'}).host.check(link())).reason,'target_changed');
  for(const fault of ['non_anchor','no_href','descriptor_non_anchor'])assert.equal((await fixture({fault}).host.check(link())).reason,'check_target_incompatible');
});

test('link destination arguments require exactly a current ref and expected URL, never an action payload',async()=>{
  for(const check of [{kind:'link_destination',expected:link().expected},link(undefined,''),{...link(),ref:12},{...link(),ref:'x'.repeat(201)},{...link(),format:{bold:true}},{...link(),action:'click'},{...link(),terms:[]},{...link(),expected:''}])await assert.rejects(fixture().host.verify([check]),/tool_arguments_invalid/);
  const invalid=await fixture().host.check(link('not-a-url'));assert.equal(invalid.reason,'url_expected_invalid');
  const restricted=await fixture().host.check(link('https://auth.openai.com/login'));assert.equal(restricted.reason,'url_expected_restricted');
});

test('tool schema and diagnostics distinguish current URL from link destination without storing values',()=>{
  const tool=browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent')).find(t=>t.function.name==='verify_page').function;
  assert(tool.parameters.properties.checks.items.properties.kind.enum.includes('link_destination'));
  assert.match(tool.description,/CURRENT TOP-LEVEL PAGE URL/);assert.match(tool.description,/without clicking/);
  assert.match(URL_VERIFICATION_GUIDE,/not a link destination/);assert.match(LINK_VERIFICATION_GUIDE,/not advertising status/);
  assert.deepEqual(verificationDiagnostic({checks:[{...link('https://private.test/?token=SECRET'),passed:false,reason:'url_query_mismatch'}]}),[{kind:'link_destination',passed:false,reason:'url_query_mismatch'}]);
});

test('link_page_is accepts the shown destination of a link whose query is hidden and says what was not compared',async()=>{
  const shown=expected=>({kind:'link_page_is',ref:'observed',expected});
  const f=fixture({href:'https://example.test/article?utm_source=PRIVATE_TRACKING#section'});
  // link_destination with the shown destination compares as a display reference and says so;
  // an expected value with its own query or fragment is still compared exactly.
  assert.deepEqual(plain(await f.host.check(link('https://example.test/article'))),{passed:true,matched:'origin_path',queryCompared:false});
  assert.equal((await f.host.check(link('https://example.test/article?utm_source=other'))).reason,'url_query_mismatch');
  assert.equal((await f.host.check(link('https://example.test/article#other'))).reason,'url_query_mismatch');
  assert.equal((await f.host.check(link('https://example.test/other'))).reason,'url_path_mismatch');
  const result=await f.host.verify([shown('https://example.test/article')]);
  assert.equal(result.verified,true);
  assert.deepEqual(plain(result.checks[0]),{index:0,kind:'link_page_is',matched:'origin_path',queryCompared:false,passed:true});
  assert(!JSON.stringify(result.checks).includes('PRIVATE_TRACKING'));
  for(const [expected,reason] of [['https://other.test/article','url_origin_mismatch'],['https://example.test/other','url_path_mismatch'],['not-a-url','url_expected_invalid']]){
    const failed=await fixture({href:'https://example.test/article?utm_source=PRIVATE_TRACKING'}).host.check(shown(expected));
    assert.equal(failed.passed,false);assert.equal(failed.reason,reason);assert(!JSON.stringify(failed).includes('PRIVATE_TRACKING'));
  }
  // A shown public identifier is part of the destination: another video on the same path fails.
  const video=fixture({href:'https://www.youtube.com/watch?v=AAAAAAAAAAA&pp=PRIVATE_TRACKING'});
  assert.equal((await video.host.check(shown('https://www.youtube.com/watch?v=AAAAAAAAAAA'))).passed,true);
  assert.equal((await video.host.check(shown('https://www.youtube.com/watch?v=BBBBBBBBBBB'))).reason,'url_identifier_mismatch');
  for(const fault of ['removed','name_changed','hidden','top_changed'])assert.equal((await fixture({fault}).host.check(shown('https://example.test/article'))).reason,'target_changed',fault);
  for(const fault of ['non_anchor','no_href'])assert.equal((await fixture({fault}).host.check(shown('https://example.test/article'))).reason,'check_target_incompatible');
  for(const check of [{kind:'link_page_is',expected:'https://example.test/article'},{...shown('https://example.test/article'),action:'click'}])await assert.rejects(fixture().host.verify([check]),/tool_arguments_invalid/);
  const tool=browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent')).find(t=>t.function.name==='verify_page').function;
  assert(tool.parameters.properties.checks.items.properties.kind.enum.includes('link_page_is'));
  assert.match(tool.description,/link_page_is/);assert.match(LINK_VERIFICATION_GUIDE,/link_page_is/);
  assert.deepEqual(verificationDiagnostic({checks:[{...shown('https://private.test/?token=SECRET'),passed:false,reason:'url_identifier_mismatch'}]}),[{kind:'link_page_is',passed:false,reason:'url_identifier_mismatch'}]);
});
