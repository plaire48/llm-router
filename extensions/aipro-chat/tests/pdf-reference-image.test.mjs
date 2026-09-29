import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {goalReviewMessages,reviewEvidence} from '../goal-review.js';
import {routeImageRequest} from '../model-routing.js';
import {splitPDFReference,pdfImageKey} from '../pdf-reference-image.js';
const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const source={url:'https://example.test/source.pdf',raw_sha256:'a'.repeat(64),page:1,page_count:3,documentId:'pdf-source-doc'};
const pdf=(changes={})=>({ok:true,dataKind:'pdf_page_reference',source:{...source,...changes},referenceImage:{mimeType:'image/png',dataUrl:`data:image/png;base64,${data}`,width:1,height:1,source:{...source,...changes}}});
const observation={tabId:1,topDocumentId:'web-doc',url:'https://example.test/',frames:[{frame:0,documentId:'web-doc',text:'Current browser text',elements:[]}]};
const call=(name,args={})=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const tools=['read_page','capture_page','navigate_page','verify_page','ask_user'].map(name=>({type:'function',function:{name,description:name,parameters:{type:'object',properties:{},additionalProperties:true}}}));
const bodyOf=messages=>JSON.parse(typeof messages[1].content==='string'?messages[1].content:messages[1].content[0].text);
const references=wire=>wire.filter(message=>Array.isArray(message.content)&&message.content[0]?.text?.startsWith('PDF source reference image'));

test('PDF source pixels remain separate from current browser images and survive navigation into final review',async()=>{
  let round=0,reviewed=0;const original=pdf(),before=structuredClone(original);
  const result=await runAgent({goal:'PDF의 그림을 확인해줘.',messages:[{role:'user',content:'PDF의 그림을 확인해줘.'}],tools,harness:true,referenceImageEnabled:true,signal:new AbortController().signal,
    complete:async wire=>{
      assert(++round<6);if(round===1)return call('capture_page');if(round===2)return call('read_page',{mode:'pdf_page',page:1,raw_sha256:source.raw_sha256});
      assert.equal(references(wire).length,1);assert(references(wire)[0].content[0].text.includes(source.raw_sha256));
      const selected={name:'text',supportsImages:false},vision={name:'vision',supportsImages:true};
      assert.equal(routeImageRequest('chatgpt',selected,vision,wire),vision);
      assert.throws(()=>routeImageRequest('chatgpt',selected,null,wire),/attachment_vision/);
      assert(wire.filter(m=>m.role==='tool').every(m=>!m.content.includes(data) && !m.content.includes('dataUrl')));
      const visual=wire.filter(m=>Array.isArray(m.content)&&m.content[0]?.text?.startsWith('Latest visual observation'));
      assert.equal(visual.length,round===3?1:0);if(round===3){assert.match(visual[0].content[0].text,/capture_page/);return call('navigate_page',{url:'https://example.test/next'});}
      return {content:'PDF 원문 1쪽의 그림을 확인했습니다.'};
    },execute:async name=>name==='read_page'?original:name==='capture_page'?{ok:true,image:{mimeType:'image/png',data},observation}:{ok:true,observation:{...observation,topDocumentId:'next-doc'}},
    reviewGoal:async request=>{
      reviewed++;assert.equal(request.image,null);assert.equal(request.sourceImages.length,1);
      const proof=request.evidence.find(e=>e.result?.dataKind==='pdf_page_reference');assert(proof.usable && proof.referenceOnly && !proof.superseded);
      const review=goalReviewMessages({...request,goal:'PDF의 그림을 확인해줘.',history:[],inputBudget:20000}),payload=bodyOf(review.messages);
      assert.deepEqual(payload.source_reference_image_evidence_ids,[proof.id]);assert(payload.citeable_evidence_ids.includes(proof.id));
      assert.equal(review.messages[1].content.filter(p=>p.type==='image_url').length,1);assert.equal(pdfImageKey(proof.result.referenceImage),pdfImageKey(request.sourceImages[0]));
      assert(!JSON.stringify(payload).includes(data));return {status:'complete'};
    }});
  assert.match(result.content,/1쪽/);assert.equal(reviewed,1);assert.deepEqual(original,before);
});

test('disabled vision and invalid source or image packets cannot become image evidence or text base64',()=>{
  for(const [index,change] of [()=>{},r=>r.referenceImage.source.page=0,r=>r.referenceImage.source.raw_sha256='bad',r=>r.referenceImage.mimeType='image/jpeg',r=>r.referenceImage.dataUrl='data:image/png;base64,notpng',r=>r.referenceImage.dataUrl='x'.repeat(6000001),r=>r.source.documentId='other',r=>r.referenceImage.source.page_count=2001,r=>{r.referenceImage.width=2001;r.referenceImage.height=2000;}].entries()) {
    const result=pdf();change(result);const split=splitPDFReference(result,index!==0);
    assert.equal(split.image,undefined);assert.equal(split.part,undefined);assert(!JSON.stringify(split.result).includes('dataUrl'));
    const evidence=reviewEvidence(1,'read_page',{mode:'pdf_page'},split.result);assert.equal(evidence.usable,false);
    const review=goalReviewMessages({goal:'PDF 그림 확인',history:[],evidence:[evidence],answer:'',inputBudget:12000});
    assert(!bodyOf(review.messages).citeable_evidence_ids.includes(1));assert.equal(typeof review.messages[1].content,'string');
  }
});

test('review requires exact attached page identity and keeps missing pixels unverified without mutating source evidence',()=>{
  const split=splitPDFReference(pdf(),true),evidence=reviewEvidence(1,'read_page',{},split.result),before=structuredClone(evidence);
  for(const images of [[],[{...split.image,evidenceId:2}],[{...split.image,evidenceId:1,source:{...source,page:2}}],[{...split.image,evidenceId:1,source:{...source,raw_sha256:'b'.repeat(64)}}]]) {
    const review=goalReviewMessages({goal:'원문 그림 확인',history:[],evidence:[evidence],sourceImages:images,answer:'',inputBudget:12000}),payload=bodyOf(review.messages);
    assert.deepEqual(payload.citeable_evidence_ids,[]);assert.equal(typeof review.messages[1].content,'string');assert.equal(payload.evidence[0].referenceImageUnavailable,true);
  }
  assert.deepEqual(evidence,before);
});

test('new PDF bytes supersede old images at the same URL and only the bounded attached pages remain reviewable',async()=>{
  let round=0;const pages=[{}, {page:2}, {page:3}, {page:1,raw_sha256:'b'.repeat(64)}];
  await runAgent({goal:'PDF 페이지 비교',messages:[{role:'user',content:'PDF 페이지 비교'}],tools,harness:true,referenceImageEnabled:true,signal:new AbortController().signal,
    complete:async wire=>{if(round){assert.equal(references(wire).length,round===4?1:Math.min(round,2));if(round===4)assert(!references(wire)[0].content[0].text.includes('a'.repeat(64)));}return round++<4?call('read_page',{mode:'pdf_page'}):{content:'새 PDF 원문 1쪽만 확인'};},
    execute:async()=>pdf(pages[round-1]),reviewGoal:async request=>{
      assert.equal(request.sourceImages.length,1);assert.equal(request.sourceImages[0].source.raw_sha256,'b'.repeat(64));
      assert.equal(request.evidence.filter(e=>e.result?.dataKind==='pdf_page_reference'&&e.usable&&!e.superseded).length,1);
      const payload=bodyOf(goalReviewMessages({...request,goal:'PDF 페이지 비교',history:[],inputBudget:18000}).messages);
      assert.equal(payload.source_reference_image_evidence_ids.length,1);return {status:'complete'};
    }});
});


test('cancellation after a PDF read prevents model delivery and final review',async()=>{
  const controller=new AbortController();let calls=0,reviews=0;
  await assert.rejects(runAgent({goal:'PDF 확인',messages:[{role:'user',content:'PDF 확인'}],tools,harness:true,referenceImageEnabled:true,signal:controller.signal,
    complete:async()=>{calls++;return call('read_page',{mode:'pdf_page'});},
    execute:async()=>{controller.abort();return pdf();},reviewGoal:async()=>{reviews++;return {status:'complete'};}}),/cancelled/);
  assert.equal(calls,1);assert.equal(reviews,0);
});

test('review attachment bound cannot silently certify pixels from earlier pages',()=>{
  const packets=[1,2,3].map(page=>splitPDFReference(pdf({page}),true));
  const evidence=packets.map((packet,index)=>reviewEvidence(index+1,'read_page',{},packet.result));
  const sourceImages=packets.map((packet,index)=>({...packet.image,evidenceId:index+1}));
  const review=goalReviewMessages({goal:'각 페이지의 그림 비교',history:[],evidence,sourceImages,answer:'',inputBudget:16000});
  const payload=bodyOf(review.messages);
  assert.deepEqual(payload.source_reference_image_evidence_ids,[2,3]);
  assert.deepEqual(payload.citeable_evidence_ids,[2,3]);
  assert.equal(payload.evidence[0].referenceImageUnavailable,true);
  assert.equal(review.messages[1].content.filter(part=>part.type==='image_url').length,2);
  assert(evidence.every(item=>item.usable));
});


test('PDF guidance consumes review context only when PDF source evidence is present',()=>{
  const ordinary=goalReviewMessages({goal:'일반 페이지 확인',history:[],evidence:[],answer:'',inputBudget:12000});
  assert(!ordinary.messages[0].content.includes('PDF source_reference_image_evidence_ids'));
  assert(!Object.hasOwn(bodyOf(ordinary.messages),'source_reference_image_evidence_ids'));
  const packet=splitPDFReference(pdf(),true),evidence=reviewEvidence(1,'read_page',{},packet.result);
  for(const phase of ['final','plan_step']) {
    const review=goalReviewMessages({goal:'PDF 확인',history:[],evidence:[evidence],sourceImages:[],answer:'',phase,
      ...(phase==='plan_step'?{stepOutcomes:[{text:'그림 확인'}]}:{}),inputBudget:12000});
    assert(review.messages[0].content.includes('PDF source_reference_image_evidence_ids'));
    assert(review.messages[0].content.includes('Missing source images leave visual source claims unverified'));
    assert.deepEqual(bodyOf(review.messages).citeable_evidence_ids,[]);
  }
});


test('evicted PDF pixels retain complete page text while visual evidence remains bounded',()=>{
  const packets=[1,2,3].map(page=>splitPDFReference({...pdf({page}),text:`Clause on page ${page}`,textTruncated:false},true));
  const evidence=packets.map((packet,index)=>reviewEvidence(index+1,'read_page',{},packet.result));
  const sourceImages=packets.map((packet,index)=>({...packet.image,evidenceId:index+1}));
  const before=structuredClone(evidence);
  for(const phase of ['final','plan_step']) {
    const review=goalReviewMessages({goal:'Compare the explicit clauses',history:[],evidence,sourceImages,answer:'',phase,
      ...(phase==='plan_step'?{stepOutcomes:[{text:'Read clauses'}]}:{}),inputBudget:16000});
    const payload=bodyOf(review.messages);
    assert.deepEqual(payload.source_reference_image_evidence_ids,[2,3]);
    assert.deepEqual(payload.source_reference_text_evidence_ids,[1]);
    assert.deepEqual(payload.citeable_evidence_ids,[1,2,3]);
    assert.equal(payload.evidence[0].referenceTextOnly,true);
    assert.equal(payload.evidence[0].referenceImageUnavailable,true);
    assert.equal(payload.evidence[0].result.text,'Clause on page 1');
    assert.equal(review.messages[1].content.filter(part=>part.type==='image_url').length,2);
    assert.match(review.messages[0].content,/never diagrams, colors, layout/);
  }
  assert.deepEqual(evidence,before);
});

test('missing, truncated and superseded PDF text cannot rescue missing page images',()=>{
  for(const textFields of [{text:'',textTruncated:false},{text:'partial',textTruncated:true},{text:'unbounded'}, {text:'x'.repeat(12001),textTruncated:false}]) {
    const packet=splitPDFReference({...pdf(),...textFields},true);
    const evidence=reviewEvidence(1,'read_page',{},packet.result);
    const payload=bodyOf(goalReviewMessages({goal:'Read clause',history:[],evidence:[evidence],sourceImages:[],answer:'',inputBudget:20000}).messages);
    assert.deepEqual(payload.citeable_evidence_ids,[]);
    assert.equal(payload.source_reference_text_evidence_ids,undefined);
  }
  const packet=splitPDFReference({...pdf(),text:'obsolete clause',textTruncated:false},true);
  const evidence={...reviewEvidence(1,'read_page',{},packet.result),usable:false,superseded:true};
  const payload=bodyOf(goalReviewMessages({goal:'Read current clause',history:[],evidence:[evidence],sourceImages:[],answer:'',inputBudget:12000}).messages);
  assert.deepEqual(payload.citeable_evidence_ids,[]);
});
