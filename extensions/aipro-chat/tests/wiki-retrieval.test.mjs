import test from 'node:test';
import assert from 'node:assert/strict';
import {searchKnowledge,learnPage,autoRefreshPage,observationHash,observationDrift,KNOWLEDGE_TTL} from '../browser-knowledge.js';
import {rankEvidence} from '../evidence-search.js';
const now=Date.now(),scope={origin:'https://portal.example',provider:'aipro'};
const page=(path,markdown,title='업무 입력 승인')=>({url:scope.origin+path,title,provider:scope.provider,verifiedAt:now,document:{headings:[title]},markdown});
const baseline=(entries,query)=>{
 const chunks=entries.flatMap((entry,index)=>[JSON.stringify(entry.document),...entry.markdown.split(/(?=^#{1,3} )/m).filter(Boolean)].map((text,part)=>({id:`${index}:${part}`,name:entry.title,context:entry.url,text})));
 return [...new Set(rankEvidence(chunks,query).slice(0,6).map(hit=>Number(hit.id.split(':')[0])))];
};
test('source-diverse retrieval improves three-page recall under the same six-excerpt budget',()=>{
 const entries=[page('/a',Array.from({length:9},(_,i)=>`## 업무 입력 승인 ${i}\n업무 입력 승인 준비 절차입니다.`).join('\n')),page('/b','# 입력\n업무를 입력합니다.','입력 안내'),page('/c','# 승인\n승인을 확인합니다.','승인 안내')];
 const before=baseline(entries,'업무 입력 승인');
 const after=searchKnowledge({entries},{...scope,query:'업무 입력 승인'},now);
 assert(before.length<3);assert.equal(after.length,3);
 assert(after.reduce((n,entry)=>n+entry.excerpts.length,0)<=6);
 console.log(JSON.stringify({evaluation:'synthetic three-page recall@3',baseline:before.length/3,current:after.length/3,realModel:false}));
});
test('long-section evidence preserves distant matches, parent heading and exact original character ranges',()=>{
 const markdown='# 작성 안내\n'+ '일반 안내입니다. '.repeat(140)+'\n검수단계에서는 결과표를 확인합니다.\n'+'일반 안내입니다. '.repeat(140)+'\n인계단계에서는 전달표를 확인합니다.';
 const entry=page('/work',markdown,'처리 절차');
 const result=searchKnowledge({entries:[entry]},{...scope,query:'검수단계 인계단계'},now)[0];
 const text=result.excerpts.map(excerpt=>excerpt.text).join('\n');assert(text.includes('결과표'));assert(text.includes('전달표'));
 for(const excerpt of result.excerpts){assert(excerpt.text.length<=902);assert.equal(excerpt.section,'# 작성 안내');assert.equal(excerpt.text,markdown.slice(excerpt.range.start,excerpt.range.end));assert.equal(excerpt.match.kind,'lexical');}
});
test('partial refresh retains reviewed rules but explicit contradictions and stale reviews exclude them',async()=>{
 const old=page('/work','# 업무 기준\n반드시 단위를 확인합니다.');old.document={headings:['업무'],fields:[{name:'시간',role:'spinbutton',required:true},{name:'설명',role:'textbox',required:false}]};old.sourceHash=await observationHash(old.document);
 const state={...learnPage(null,old,0,now),autoUpdate:true};
 const observation={frames:[{headings:[{name:'업무'}],elements:[{name:'시간',role:'spinbutton',required:true}],truncated:true}]};
 const partial={...old,document:{headings:['업무'],fields:[old.document.fields[0]]},verifiedAt:now+1,contradiction:await observationDrift(state,old.url,old.provider,observation)};
 partial.sourceHash=await observationHash(partial.document);
 const guard={revision:0,expectedVersion:1,completed:true};
 const updated=autoRefreshPage(state,partial,guard,now+1);
 assert.equal(updated.entries[0].markdownNeedsReview,false);assert(searchKnowledge(updated,{...scope,query:'단위'},now+1)[0].markdown.includes('단위'));
 assert.equal(autoRefreshPage(state,{...partial,contradiction:true},guard,now+1).entries[0].markdownNeedsReview,true);
 assert.equal(searchKnowledge({...updated,entries:updated.entries.map(entry=>({...entry,verifiedAt:now+KNOWLEDGE_TTL+2}))},{...scope,query:'단위'},now+KNOWLEDGE_TTL+2).length,0);
});
test('retrieval never crosses provider or origin and does not turn empty or partial matches into confidence',()=>{
 const entries=[page('/a','# 승인\n업무 승인 확인'),{...page('/b','# 승인\n비공개 내용'),provider:'fabrix'}, {...page('/c','# 승인\n다른 사이트'),url:'https://other.example/a'}];
 assert.equal(searchKnowledge({entries},{...scope,query:'승인'},now).length,1);
 assert.deepEqual(searchKnowledge({entries},{...scope,query:'알수없는용어'},now),[]);
 const result=searchKnowledge({entries},{...scope,query:'승인 알수없는용어'},now)[0];
 assert(result.excerpts.every(e=>e.match.coverage<1 && e.match.confidence===false));
});
test('URL-only menu identifiers remain searchable and dense headings preserve tail evidence',()=>{
 const urlEntry=page('/work?menu=FP_entry','# 작성\n내용을 확인합니다.','업무 안내');
 assert.equal(searchKnowledge({entries:[urlEntry]},{...scope,query:'FP_entry'},now)[0].url,urlEntry.url);
 const markdown=Array.from({length:700},(_,i)=>`## 안내 ${i}\n일반 설명\n`).join('')+'\n## 마지막 확인\n최종검수코드의 의미를 확인합니다.';
 assert(markdown.length<16000);
 const result=searchKnowledge({entries:[page('/dense',markdown,'복합 안내')]},{...scope,query:'최종검수코드'},now)[0];
 assert(result.excerpts.some(excerpt=>excerpt.text.includes('최종검수코드')));
 assert(result.excerpts.every(excerpt=>Number(excerpt.id.split(':').at(-1))<=64));
 for(const excerpt of result.excerpts)assert.equal(markdown.slice(excerpt.range.start,excerpt.range.end),excerpt.text);
});
