import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureApprovalAllowed as allowed} from '../scripts/evaluation-fixture-approval.mjs';
const sample=()=>({enabled:true,taskId:'H-08',origin:'http://127.0.0.1:3000',pageUrl:'http://127.0.0.1:3000/H-08',conversationId:'run',question:{id:'q',kind:'approval'},record:{questionId:'q',conversationId:'run',operation:{method:'download',url:'http://127.0.0.1:3000/training.txt'}}});
test('fixture operator approves only the exact local download and conversation',()=>{
  assert(allowed(sample()));
  for(const changes of [{enabled:false},{taskId:'E-01'},{origin:'https://example.com'},{pageUrl:'http://127.0.0.1:3001/H-08'},{conversationId:'other'},{question:{id:'q',kind:'approval',answer:{}}}])assert(!allowed({...sample(),...changes}));
  for(const url of ['https://example.com/training.txt','http://127.0.0.1:3000/other.txt','http://127.0.0.1:3000/training.txt?x=1']){const x=sample();x.record.operation.url=url;assert(!allowed(x));}
});
test('fixture upload approval excludes submission and unrelated files',()=>{
  const x=sample();x.taskId='H-09';x.pageUrl=x.origin+'/H-09';x.record.operation={method:'upload',files:[{name:'training.txt'}]};assert(allowed(x));
  x.record.operation.method='click';assert(!allowed(x));x.record.operation.method='upload';x.record.operation.files.push({name:'private.txt'});assert(!allowed(x));
});
test('the work sheet operator approves only its final apply click', () => {
  const x = sample(); x.taskId = 'W-01'; x.pageUrl = x.origin + '/W-01'; x.record.operation = {method: 'click'}; x.record.action = '반영';
  assert(allowed(x));
  for (const change of [record => {record.action = '제출';}, record => {record.operation = {method: 'upload', files: [{name: 'training.txt'}]};}, record => {record.operation = {method: 'download', url: x.origin + '/training.txt'};}]) {
    const y = structuredClone(x); change(y.record); assert(!allowed(y));
  }
  const other = structuredClone(x); other.pageUrl = x.origin + '/M-08'; assert(!allowed(other));
});
