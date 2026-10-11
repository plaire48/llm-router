import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchConversations,highlightParts} from '../ui/conversation-search.mjs';
import {fixture} from './fixtures.mjs';
test('search finds body terms beyond the recent fifty and opens old conversations',async t=>{
 const {service}=await fixture(t);
 const old={id:'old',request:'아침 식사 추천',createdAt:'2025-01-01',state:'review',messages:[{role:'user',content:'간단한 메뉴가 필요해요.'},{role:'assistant',content:'앞부분 '.repeat(2000)+'따뜻한 빵과 우유를 추천합니다.'}]};
 service.store.set('task:old',old);
 for(let i=0;i<60;i++)service.store.set('task:new-'+i,{id:'new-'+i,request:'최근 대화 '+i,createdAt:'2026-10-12',state:'review',messages:[]});
 assert.equal(service.state().tasks.some(task=>task.id==='old'),false);
 const result=await service.invoke('conversationHistory',{query:'빵'});
 assert.equal(result.total,1);assert.equal(result.items[0].match.role,'assistant');assert.match(result.items[0].match.snippet,/빵과 우유/);assert(result.items[0].match.snippet.length<140);
 assert.equal((await service.invoke('conversationHistory',{taskId:'old'})).messages[1].content,old.messages[1].content);
 assert(service.state({taskId:'old'}).tasks.some(task=>task.id==='old'));
 assert.equal((await service.invoke('overview',{taskId:'old'})).tasks.some(task=>task.id==='old'),true);
 const first=service.conversationHistory({limit:50}),second=service.conversationHistory({offset:50});assert.equal(first.total,61);assert(first.hasMore);assert.equal(second.items.length,11);
});
test('literal matching supports Korean, case, punctuation and message text parts',()=>{
 const tasks=[{id:'a',request:'메뉴',messages:[{role:'user',content:[{type:'text',text:'빵 [a+b] BREAD'}]},{role:'assistant',content:'식빵도 빵입니다.'},{role:'tool',content:'비공개 도구 키워드'}]}];
 for(const query of ['빵','bread','[a+b]'])assert.equal(searchConversations(tasks,{query}).total,1);
 assert.equal(searchConversations(tasks,{query:'비공개'}).total,0);
 assert.deepEqual(highlightParts('식빵도 빵입니다.','빵').filter(part=>part.match).map(part=>part.text),['빵','빵']);
 assert.equal(highlightParts('<script>[a+b]</script>','[a+b]').filter(part=>part.match)[0].text,'[a+b]');
 assert.equal(searchConversations(tasks,{query:'없는 단어'}).total,0);
});
