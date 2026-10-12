import test from 'node:test';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import assert from 'node:assert/strict';
import {MailSearch} from '../runtime/mail-search.mjs';
import {mailSearchDraft} from '../ui/mail-search-draft.mjs';

function fixture(){
  const data=new Map(),rows=[{id:'one',sourceHash:'hash-one',state:'saved',date:'2026-10-11'},{id:'two',sourceHash:'hash-two',state:'saved',date:'2026-10-10'}];
  const sources={one:{subject:'분기 계획',from:'김누비 <nubi@example.test>',to:'팀장 <lead@example.test>',cc:'재무팀 <finance@example.test>',date:'2026-10-11',text:'예산 승인 요청\n'+'본문 '.repeat(1000)+'마지막 일정',attachments:[{id:'file',filename:'비용.xlsx',contentState:'document_read',segments:[{sheet:'결산',text:'공급사 정산'}]}]},two:{subject:'분기 계획',from:'other@example.test',text:'마지막 일정',attachments:[]}};
  const owner={store:{get:key=>data.get(key),set:(key,value)=>data.set(key,value),list:prefix=>[...data].filter(([key])=>key.startsWith(prefix)).map(([,value])=>value)},rows:()=>rows,searchSignature:async row=>row.sourceHash,read:async id=>({mail:sources[id]}),readKnowledge:async()=>({text:''})};
  rows.forEach(row=>data.set('mail:'+row.id,row));
  return {search:new MailSearch(owner),rows,sources};
}
test('ordinary terms ignore URL tracking parameters across chunks while exact URLs remain searchable',async()=>{
  const {search,sources}=fixture();
  sources.one.from=sources.two.from='LinkedIn <notice@linkedin.com>';
  sources.one.text='RAG 기초 강의 자료';
  sources.two.text='메시지 알림 https://linkedin.com/messaging?token='+ 'a'.repeat(1400)+'RAGtail';
  const result=await search.search({query:'LinkedIn RAG'});
  assert.deepEqual(result.results.map(row=>row.id),['one']);
  assert.equal(result.results[0].preview,'RAG 기초 강의 자료');
  assert.equal((await search.search({query:'https://linkedin.com/messaging'})).total,1);
  assert.equal((await search.search({query:'https://linkedin.com/messaging RAGtail'})).total,1);
  assert(!Object.hasOwn(result.results[0].match,'searchText'));
});
test('short Latin search terms do not match unrelated words such as mail and storage',async()=>{
  const {search,sources}=fixture();sources.one.text='AI업무와 RAG 강의';sources.two.text='mail and Cloud Storage';
  assert.deepEqual((await search.search({query:'RAG'})).results.map(row=>row.id),['one']);
  assert.deepEqual((await search.search({query:'AI'})).results.map(row=>row.id),['one']);
});
test('AND spans sender, subject, distant body passages and attachment but never different emails',async()=>{
  const {search}=fixture();
  for(const query of ['김누비 예산','분기 승인 마지막',...(DESKTOP_FEATURES.mailAttachmentReading?['김누비 비용 정산']:['김누비 비용']),'lead@example.test 승인','재무팀 승인','2026-10-11 승인']){
    const result=await search.search({query});assert.deepEqual(result.results.map(item=>item.id),['one'],query);assert.equal(result.results[0].sourceHash,'hash-one');
  }
  assert.equal((await search.search({query:'other 승인'})).total,0);
  const matches=(await search.search({query:DESKTOP_FEATURES.mailAttachmentReading?'김누비 승인 정산':'김누비 승인 비용'})).results[0].matches;
  assert(matches.some(item=>item.kind==='subject'));assert(matches.some(item=>item.kind==='body'));if(DESKTOP_FEATURES.mailAttachmentReading)assert(matches.some(item=>item.sheet==='결산'));else {assert(matches.some(item=>item.filenameOnly));assert.equal((await search.search({query:'정산'})).total,0);}
});
test('location and metadata filters apply before cross-field matching; tags refresh without reimport',async()=>{
  const {search}=fixture();
  assert.equal((await search.search({query:'김누비 승인',filters:{locations:['body']}})).total,0);
  assert.equal((await search.search({query:'김누비 승인',filters:{senders:['other']}})).total,0);
  assert.equal((await search.search({query:'재무팀',filters:{locations:['metadata']}})).total,1);
  search.update('one',{tags:['핵심업무']});
  assert.equal((await search.search({query:'핵심업무 승인'})).total,1);
  search.update('one',{tags:[]});assert.equal((await search.search({query:'핵심업무 승인'})).total,0);
});
test('cross-field results retain stable paging and reset changed snapshots',async()=>{
  const {search}=fixture();
  const first=await search.search({query:'분기 마지막',limit:1});assert.equal(first.total,2);
  const next=await search.search({query:'분기 마지막',limit:1,cursor:first.nextCursor});assert.notEqual(next.results[0].id,first.results[0].id);
  search.update('one',{pinned:true});
  const reset=await search.search({query:'분기 마지막',limit:1,cursor:first.nextCursor});assert.equal(reset.reset,true);assert.equal(reset.offset,0);
});
test('AI handoff preserves the draft and search conditions, uses mail command and rejects overflow',()=>{
  const filters={period:'custom',from:'2026-10-01',to:'2026-10-11',senders:['김누비'],locations:['metadata'],tags:['핵심'],pinned:true};
  const text=mailSearchDraft('', '예산 승인',filters);
  assert(text.startsWith('/mail '));for(const part of ['2026-10-01','김누비','받는 사람','핵심','고정한 메일','예산 승인'])assert(text.includes(part));
  assert(mailSearchDraft('작성 중인 초안', '예산',{}).startsWith('작성 중인 초안\n\n'));
  assert.throws(()=>mailSearchDraft('x'.repeat(16000),'예산'),/agent_input_invalid/);
});
test('table sorting covers all filtered results before pagination and mailbox never guesses from sender',async()=>{
 const {search,rows,sources}=fixture();sources.one.subject='Zulu';sources.two.subject='Alpha';rows[1].mailbox='sent';rows[0].recipientRole='cc';
 const first=await search.search({sort:'subject-asc',limit:1});assert.equal(first.results[0].id,'two');const second=await search.search({sort:'subject-asc',limit:1,cursor:first.nextCursor});assert.equal(second.results[0].id,'one');
 const inbox=await search.search({filters:{mailbox:'inbox'}});assert.deepEqual(inbox.results.map(r=>r.id),['one']);assert.equal(inbox.results[0].recipientRole,'cc');assert.equal(inbox.results[0].senderLabel,'김누비 / nubi@example.test');
 assert.deepEqual((await search.search({filters:{mailbox:'sent'}})).results.map(r=>r.id),['two']);
});
