import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createBrowserDiagnostics} from '../browser-diagnostics.js';
import {createHarness} from '../agent-harness.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const allowedURL = value => {try {const url = new URL(value); return url.protocol === 'https:' && url.hostname !== 'login.test' ? url.origin + url.pathname : null;} catch {return null;}};
function fixture(t) {
  const page = Object.assign(new EventEmitter(), {address:'https://work.test/', url(){return this.address;}, mainFrame(){return this;}, frames(){return [this];}});
  let current = page;
  const journal = createBrowserDiagnostics({allowedURL, currentPage:()=>current});
  journal.watch(page); t.after(()=>journal.close());
  return {page,journal,select:p=>{current=p;}, console:(text,level='error',url=page.url())=>page.emit('console',{type:()=>level,text:()=>text,location:()=>({url,lineNumber:2}),args:()=>assert.fail('No console object inspection')})};
}
function request(url, frameURL='https://work.test/') {
  return {url:()=>url,frame:()=>({url:()=>frameURL}),method:()=>'POST',resourceType:()=>'fetch',failure:()=>({errorText:'net::ERR_FAILED'}),headers:()=>assert.fail('No headers'),postData:()=>assert.fail('No body')};
}
test('diagnostics filter secrets and URL query fragments without inspecting request data',t=>{
  const f=fixture(t);
  f.console('Server unavailable at https://api.test/result?private=QUERY#FRAGMENT');
  f.console('Authorization: Bearer PRIVATE');f.console('비밀번호 PRIVATE');
  f.page.emit('response',{request:()=>request('https://api.test/result?private=QUERY'),status:()=>503});
  f.page.emit('requestfailed',request('https://api.test/offline'));
  f.page.emit('response',{request:()=>request('https://login.test/auth'),status:()=>401});
  f.page.emit('response',{request:()=>request('https://api.test/secret','https://login.test/auth'),status:()=>401});
  const result=f.journal.read();assert.equal(result.events.length,5);
  assert(!JSON.stringify(result).match(/PRIVATE|QUERY|FRAGMENT|login.test/));
  assert(result.events.some(e=>e.status===503));assert(result.events.some(e=>e.failed));
  assert.match(result.scope,/not proof of business completion/);
});
test('diagnostics isolate page objects even at the same URL and clear on navigation and close',t=>{
  const f=fixture(t);f.console('First page error');
  const other=Object.assign(new EventEmitter(),{url:()=>f.page.url(),mainFrame(){return this;},frames(){return [this];}});
  f.journal.watch(other);f.select(other);f.console('BACKGROUND');
  assert.equal(f.journal.read().events.length,0);
  f.select(f.page);assert.equal(f.journal.read().events.length,1);
  f.page.emit('framenavigated',{});assert.equal(f.journal.read().events.length,1);
  f.page.emit('framenavigated',f.page);assert.equal(f.journal.read().events.length,0);
  f.console('Next document');f.page.address='https://login.test/auth';
  assert.throws(()=>f.journal.read(),/page_restricted/);
  f.journal.close();assert.equal(f.page.eventNames().length,0);assert.equal(other.eventNames().length,0);
});
test('diagnostics bound storage, support cursor filters and return detached values',t=>{
  const f=fixture(t);for(let i=0;i<205;i++)f.console(`event ${i}`,i%2?'log':'error');
  const first=f.journal.read({limit:2});assert.equal(first.omitted,5);assert.equal(first.events.length,2);
  const cursor=first.next_cursor;first.events[0].text='MUTATED';
  assert(!JSON.stringify(f.journal.read()).includes('MUTATED'));
  assert(f.journal.read({since:cursor}).events.every(e=>e.id>cursor));
  assert.equal(f.journal.read({kind:'network'}).events.length,0);
  assert.equal(f.journal.read({errors_only:false,limit:40}).events.length,40);
  for(const args of [{limit:0},{limit:41},{since:-1},{since:1.5},{errors_only:'false'},{kind:'body'}])assert.throws(()=>f.journal.read(args),/tool_arguments_invalid/);
});
test('failed scripts expose diagnostics but HTTP 200 cannot satisfy completion verification',()=>{
  const harness=createHarness(browserTools({},BUILTIN_SKILLS[0]));
  harness.observe('run_playwright',{error:'script_failed',actionIssued:true});
  assert(harness.advertised().some(t=>t.function.name==='read_browser_diagnostics'));
  harness.observe('read_browser_diagnostics',{ok:true,events:[{status:200}]});
  assert.equal(harness.needsCheck(),true);
});
test('unattributed console errors cannot expose restricted iframe output',t=>{
  const f=fixture(t);f.page.frames=()=>[f.page,{url:()=>'https://login.test/auth'}];
  f.console('Private frame message','error','');f.page.emit('pageerror',new Error('Private frame exception'));
  assert.deepEqual(f.journal.read().events,[]);assert.equal(f.journal.read().consoleCoverage,'limited_by_restricted_frames');
  f.page.frames=()=>[f.page];f.console('Visible work error');assert.equal(f.journal.read().events.length,1);
});
