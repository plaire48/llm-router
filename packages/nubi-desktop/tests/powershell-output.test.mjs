import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {powerShellOutputDecoder,processOutputDiagnostic} from '../runtime/powershell-output.mjs';
import {processOutputPreview,commandProblem} from '../runtime/process-output.mjs';
import {Processes} from '../runtime/processes.mjs';
import {fixture} from './fixtures.mjs';

const error='Get-ChildItem : C:\\보호 폴더 접근 거부_x000D__x000A_    + FullyQualifiedErrorId : DirUnauthorizedAccessError,Microsoft.PowerShell.Commands.GetChildItemCommand_x000D__x000A_';
const document=body=>'#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">'+body+'</Objs>';
const xml=document('<Obj S="progress"><MS><PR><AV>모듈 준비</AV><SD>읽는 중</SD></PR></MS></Obj><S S="Error">'+error+'</S>');
const decode=(text,size)=>{const stream=powerShellOutputDecoder();let output='';for(let i=0;i<text.length;i+=size)output+=stream.write(text.slice(i,i+size));return output+stream.end();};

test('CLIXML errors, progress and Korean survive arbitrary chunk boundaries as readable text',()=>{
  for(const size of [1,2,7,113,65536]){
    const result=decode('파일 목록\n'+xml+'\n끝',size);
    assert.match(result,/파일 목록\n모듈 준비 — 읽는 중\nGet-ChildItem : C:\\보호 폴더 접근 거부\r\n/);
    assert.match(result,/FullyQualifiedErrorId : DirUnauthorizedAccessError/);
    assert.ok(result.endsWith('\n끝'));assert.doesNotMatch(result,/<Objs|_x000D_|<S /);
  }
});
test('plain output streams immediately and literal escapes are decoded only once in marked XML',()=>{
  const stream=powerShellOutputDecoder();assert.equal(stream.write('hello'),'hello');assert.equal(stream.write(' world'),' world');assert.equal(stream.end(),'');
  const plain='<Objs>unmarked XML</Objs> _x000A_';assert.equal(decode(plain,1),plain);
  assert.equal(decode(document('<S S="Error">&lt;tag&gt; _x005F_x0041_ _xD83D__xDE00_</S>'),3),'<tag> _x0041_ 😀');
  assert.equal(decode(document('<S>A</S>')+'\n'+document('<S>B</S>'),2),'A\nB');
});
test('malformed, unsupported, interrupted and oversized output stays available without XML entity expansion',()=>{
  for(const raw of [xml.slice(0,-8),document('<S>&undefined;</S>'),document('<Obj S="Error"><ToString>original evidence</ToString></Obj>'),document('<S>'+'x'.repeat(270000)+'</S>'),document('<S>text</S>').replace('<Objs','<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><Objs')])assert.equal(decode(raw,1000),raw);
  assert.equal(decode('#< CLI',1),'#< CLI');
});
test('directory denials are partial coverage diagnostics, separate from malformed commands and HTTP authentication',()=>{
  const record={state:'completed',exitCode:0,output:decode(xml,17)},diagnostic=processOutputDiagnostic(record);
  assert.equal(diagnostic.kind,'directory_access_denied');assert.match(diagnostic.instruction,/do not claim complete directory coverage/);
  assert.equal(commandProblem(record),null);assert.equal(processOutputPreview(record).outputDiagnostic.kind,'directory_access_denied');
  for(const output of ['HTTP 401 Unauthorized','PSSecurityException: UnauthorizedAccess','EACCES','DirUnauthorizedAccessError in documentation'])assert.equal(processOutputDiagnostic({output}),null);
});
test('real process pipes normalize split UTF-8 CLIXML while retaining raw disk evidence and exit status',async t=>{
  const {service,root}=await fixture(t);
  const processes=new Processes(service.store,{profiles:async()=>[{id:'fixture',executable:process.execPath,args:['-e']}]});t.after(()=>processes.dispose());
  const script=`const b=Buffer.from(${JSON.stringify(xml)});let i=0;const tick=setInterval(()=>{process.stderr.write(b.subarray(i,i+17));i+=17;if(i>=b.length){clearInterval(tick);process.exitCode=3;}},1);`;
  const started=await processes.start({cwd:root,taskId:'xml-test',profile:'fixture',script,autoDiagnose:false});
  const deadline=Date.now()+10000;while(processes.active.size&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  const record=processes.poll(started.id);assert.equal(record.state,'failed');assert.equal(record.exitCode,3);
  assert.equal(record.output,decode(xml,100));assert.equal(record.outputDiagnostic.kind,'directory_access_denied');
  assert.equal(await readFile(record.logPath,'utf8'),xml);assert.equal(service.store.list('process:').length,1);
});
