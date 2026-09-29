// What the OpenWiki update card says in each state. Text only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wikiUpdateView} from '../ui/wiki-update-view.mjs';

const stale={state:'stale',lastUpdate:{updatedAt:'2026-09-29T00:00:00.000Z'},changedFiles:['src/a.mjs','src/b.mjs'],stalePages:[{path:'openwiki/home.md',freshness:'source_changed'},{path:'openwiki/old.md',freshness:'unavailable'}],uncommitted:['notes.txt']};

test('a stale Wiki offers an update and says what it costs and what it sends',()=>{
  const view=wikiUpdateView({status:stale,update:null});
  assert.equal(view.title,'OpenWiki 갱신 제안');
  assert.deepEqual(view.pages,[{path:'openwiki/home.md',label:'원본이 바뀜'},{path:'openwiki/old.md',label:'원본이 없음'}]);
  assert.match(view.lines.join('\n'),/마지막 갱신 뒤 바뀐 파일 2개/);
  assert.match(view.lines.join('\n'),/커밋하지 않은 변경 1개는 갱신에 들어가지 않아요/);
  assert.match(view.lines.join('\n'),/저장소 내용이 모델에 전달/);assert.match(view.lines.join('\n'),/결과를 확인한 뒤에 반영/);
  assert.deepEqual(view.actions,['run']);
});

test('a current Wiki and a Wiki without a generation record offer nothing to run',()=>{
  assert.deepEqual(wikiUpdateView({status:{state:'current',lastUpdate:{updatedAt:'2026-09-29T00:00:00.000Z'}},update:null}).actions,[]);
  assert.match(wikiUpdateView({status:{state:'current',lastUpdate:{updatedAt:'2026-09-29T00:00:00.000Z'}},update:null}).title,/최신/);
  const unknown=wikiUpdateView({status:{state:'unknown'},update:null});
  assert.deepEqual(unknown.actions,[]);assert.match(unknown.lines.join(' '),/생성 기록이 없어/);
});

test('a running update shows its stage and can be stopped',()=>{
  const view=wikiUpdateView({status:stale,update:{state:'running',events:[{type:'progress',stage:'planning'},{type:'progress',stage:'generating',page:'openwiki/home.md',index:2,total:5}]}});
  assert.equal(view.title,'OpenWiki 갱신 중');assert.match(view.lines[0],/페이지 작성 2\/5: openwiki\/home\.md/);assert.deepEqual(view.actions,['cancel']);
});

test('a finished update lists the pages to apply and what is left out',()=>{
  const view=wikiUpdateView({status:stale,update:{state:'ready',changes:[{path:'openwiki/home.md',change:'modified'},{path:'openwiki/new.md',change:'added'},{path:'openwiki/gone.md',change:'deleted'}],outside:['AGENTS.md']}});
  assert.equal(view.title,'OpenWiki 갱신 결과');
  assert.deepEqual(view.pages,[{path:'openwiki/home.md',label:'수정'},{path:'openwiki/new.md',label:'추가'},{path:'openwiki/gone.md',label:'삭제'}]);
  assert.match(view.lines.join('\n'),/반영하지 않는 파일: AGENTS\.md/);assert.deepEqual(view.actions,['apply','discard']);
  const empty=wikiUpdateView({status:stale,update:{state:'ready',changes:[],outside:[]}});
  assert.match(empty.lines.join(' '),/바뀐 페이지가 없어요/);assert.deepEqual(empty.actions,['discard']);
  const skipped=wikiUpdateView({status:stale,update:{state:'ready',changes:[{path:'openwiki/.last-update.json',change:'modified'}],outside:[],result:{skipped:true}}});
  assert.match(skipped.lines.join(' '),/다시 쓸 페이지가 없다고 판단/,'a run that OpenWiki found unnecessary says so');
  const cited=wikiUpdateView({status:stale,update:{state:'ready',changes:[{path:'openwiki/home.md',change:'modified'}],outside:['AGENTS.md'],outsideEvidence:[{page:'openwiki/home.md',path:'AGENTS.md'}]}});
  assert.match(cited.lines.join(' '),/근거로 인용한 페이지가 있어요.*openwiki\/home\.md\(AGENTS\.md\)/,'pages that cite a file that is not applied are named');
});

test('the end of an update is said plainly',()=>{
  assert.match(wikiUpdateView({status:{state:'current'},update:{state:'applied',changes:[{path:'a',change:'modified'}]}}).lines[0],/1개 파일을 반영/);
  assert.match(wikiUpdateView({status:stale,update:{state:'cancelled'}}).lines[0],/작업 공간은 그대로/);
  assert.match(wikiUpdateView({status:stale,update:{state:'failed',error:'model_unavailable'}}).lines[0],/모델에 연결/);
  assert.match(wikiUpdateView({status:stale,update:{state:'discarded'}}).lines[0],/버렸어요/);
});
