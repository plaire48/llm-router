// Compares two evaluation reports case by case and cost by purpose:
//   node eval/compare.mjs <before>/report.json <after>/report.json
// It reports differences only. A small case set cannot establish that one
// candidate is better; read the per-case rows.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const KIND='desktop-live-model-evaluation';
const number=value=>Number.isFinite(value)?value:0;
const share=value=>value===null||value===undefined?'-':(value*100).toFixed(1)+'%';
const delta=(before,after)=>{const change=number(after)-number(before);return change===0?'0':(change>0?'+':'')+change;};

export function compareReports(before,after){
  for(const report of [before,after])if(report?.kind!==KIND||!Array.isArray(report.results))throw new Error('report_invalid');
  if(before.model!==after.model||before.provider!==after.provider)throw new Error('report_model_differs');
  const shared=Object.keys(before.corpora).filter(name=>name in after.corpora);
  if(shared.some(name=>before.corpora[name]!==after.corpora[name]))throw new Error('report_corpus_differs');
  const key=result=>result.id+'#'+result.trial,earlier=new Map(before.results.map(result=>[key(result),result]));
  const cases=after.results.filter(result=>earlier.has(key(result))).map(result=>{
    const old=earlier.get(key(result));
    return {id:result.id,trial:result.trial,suite:result.suite,split:result.split,before:old.outcome,after:result.outcome,changed:old.outcome!==result.outcome,
      modelCalls:[number(old.modelCalls),number(result.modelCalls)],promptTokens:[number(old.metrics?.promptTokens),number(result.metrics?.promptTokens)],elapsedMs:[number(old.elapsedMs),number(result.elapsedMs)]};
  });
  const purposes=[...new Set([...Object.keys(before.summary.cost.byPurpose),...Object.keys(after.summary.cost.byPurpose)])].sort().map(purpose=>{
    const old=before.summary.cost.byPurpose[purpose]||{},next=after.summary.cost.byPurpose[purpose]||{};
    return {purpose,calls:[number(old.calls),number(next.calls)],promptTokens:[number(old.promptTokens),number(next.promptTokens)],elapsedMs:[number(old.elapsedMs),number(next.elapsedMs)]};
  });
  return {model:after.model,sameCandidate:before.candidate.hash===after.candidate.hash,candidates:[before.candidate.hash,after.candidate.hash],
    onlyBefore:before.results.filter(result=>!after.results.some(other=>key(other)===key(result))).map(key),onlyAfter:after.results.filter(result=>!earlier.has(key(result))).map(key),
    quality:[before.summary.quality,after.summary.quality],fixedShare:[before.summary.cost.fixedShare,after.summary.cost.fixedShare],cacheShare:[before.summary.cost.cacheShare,after.summary.cost.cacheShare],cases,purposes};
}

export function renderComparison(comparison){
  const [before,after]=comparison.quality,row=cells=>'| '+cells.join(' | ')+' |',lines=[];
  lines.push('# 평가 비교','',`- 모델: ${comparison.model}`,`- 후보: ${comparison.candidates[0].slice(0,12)} → ${comparison.candidates[1].slice(0,12)}`+(comparison.sameCandidate?' (같은 후보의 반복 측정)':''),'');
  lines.push('## 품질','',row(['지표','이전','이후','차이']),row(['---','---:','---:','---:']));
  for(const [label,name] of [['실행한 과제','executed'],['독립 통과','passed'],['답변 전달','delivered'],['잘못된 완료','falseCompletion'],['검토 상한 전달','reviewLimit'],['검토 반복 전달','reviewStalled'],['불필요한 질문','unnecessaryQuestion'],['필요한 질문 누락','missedQuestion'],['정답 경로 도달','retrievalReached'],['정답 경로 인용','citationFound']])
    // A report made before a measure existed counts as zero.
    lines.push(row([label,before[name]??0,after[name]??0,delta(before[name]??0,after[name]??0)]));
  lines.push('','## 비용','',row(['목적','호출 이전','호출 이후','입력 토큰 이전','입력 토큰 이후','입력 토큰 차이']),row(['---','---:','---:','---:','---:','---:']));
  for(const item of comparison.purposes)lines.push(row([item.purpose,...item.calls,...item.promptTokens,delta(...item.promptTokens)]));
  lines.push('',`- 고정 비용 비중: ${share(comparison.fixedShare[0])} → ${share(comparison.fixedShare[1])}`,`- 캐시 비율: ${share(comparison.cacheShare[0])} → ${share(comparison.cacheShare[1])}`,'');
  lines.push('## 과제별','',row(['과제','묶음','구분','이전','이후','모델 호출','입력 토큰']),row(['---','---','---','---','---','---:','---:']));
  for(const item of comparison.cases)lines.push(row([item.id+(item.trial>1?' #'+item.trial:''),item.suite,item.split,item.before,(item.changed?'**'+item.after+'**':item.after),item.modelCalls.join(' → '),item.promptTokens.join(' → ')]));
  if(comparison.onlyBefore.length||comparison.onlyAfter.length)lines.push('',`- 한쪽에만 있는 과제: 이전 ${comparison.onlyBefore.join(', ')||'없음'}, 이후 ${comparison.onlyAfter.join(', ')||'없음'}`);
  lines.push('','과제 수가 적습니다. 이 표는 차이를 보여줄 뿐 우열을 입증하지 않습니다. 사내 모델이나 회사 저장소의 성능이 아닙니다.','');
  return lines.join('\n');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [first,second]=process.argv.slice(2);
  if(!first||!second){console.error('사용법: node eval/compare.mjs <이전 report.json> <이후 report.json>');process.exit(2);}
  try{console.log(renderComparison(compareReports(JSON.parse(await readFile(first,'utf8')),JSON.parse(await readFile(second,'utf8')))));}
  catch(error){console.error(({report_model_differs:'두 보고서의 모델이 다릅니다. 비교하지 않습니다.',report_corpus_differs:'두 보고서의 자료가 다릅니다. 비교하지 않습니다.',report_invalid:'평가 보고서 형식이 아닙니다.'})[error.message]||'보고서를 읽지 못했습니다.');process.exit(1);}
}
