// Nubi Workspace context-policy.mjs/context-manager.js, adapted to GenOffice.
// No second agent runtime. Preserve reported capacity and distinguish estimates.
export const CONTEXT_SUMMARY_RATIO=.75;
export function estimateTokens(text){let ascii=0,unicode=0;for(const c of String(text||''))c.codePointAt(0)<=127?ascii++:unicode++;return Math.ceil(ascii/4+unicode*1.5);}
const positive=v=>Number.isSafeInteger(v)&&v>0?v:null;
export function contextBudget(model={}){
 // Workspace conversationModel reserves reply space before contextBudget.
 if(positive(model.contextLength)){const reported=positive(model.maxOutputTokens)||24576,reserve=Math.max(4096,Math.min(reported,32768,Math.max(1024,Math.floor(model.contextLength*.15))));model={...model,maxInputTokens:Math.min(positive(model.maxInputTokens)||Infinity,Math.max(0,model.contextLength-reserve))};}
 const capacity=positive(model.contextLength),maximum=positive(model.maxInputTokens),ceiling=Math.min(24576,positive(model.maxOutputTokens)||24576);
 const output=capacity?Math.min(ceiling,Math.max(1024,Math.floor(capacity*.15))):ceiling;
 const input=Math.max(1024,Math.min(maximum||Infinity,capacity?capacity-output:maximum||120000));
 const large=capacity!==null&&input>=128000,trigger=large?Math.min(input,Math.floor(capacity*CONTEXT_SUMMARY_RATIO)):Math.floor(input*.75);
 return {capacity,input,output,trigger,recentTokens:large?Math.min(96000,Math.floor(input*.2)):Math.min(20000,Math.max(1024,Math.floor(input*.3))),summaryInput:large?Math.min(120000,Math.floor(input*.2)):Math.min(60000,input)};
}
export function meterInfo(record,model={},draft=''){
 const budget=contextBudget(model),same=record?.model===(model.id||model.name);
 const measured=same&&record?.kind==='measured'&&!draft.trim();
 const base=same&&Number.isSafeInteger(record?.used)&&record.used>=0?record.used:null;
 const extra=estimateTokens(draft),used=base===null?null:base+extra;
 const remaining=used!==null&&budget.capacity?Math.max(0,budget.capacity-used):null;
 return {used,capacity:budget.capacity,ratio:used!==null&&budget.capacity?used/budget.capacity:null,kind:measured?'measured':used===null?'unknown':used===0?'empty':'estimated',usage:measured?record.reported:null,remaining,compactAt:budget.capacity?budget.trigger:undefined,compactLabel:budget.capacity&&budget.input>=128000?'자동 요약 (75%)':'자동 요약',source:measured?'마지막 응답 실측':used===null?'':record?.reason==='compaction'?'요약 후 추정':'대화 문맥 추정',note:measured?'모델이 알려 준 마지막 요청 사용량입니다. 남은 값은 모델 문맥 한도 기준이며 계정 이용 한도와 다릅니다.':'문맥과 도구 결과의 추정치입니다. 긴 도구 출력은 GenOffice가 먼저 정리할 수 있습니다. 모델 한도가 없으면 비율을 표시하지 않습니다.'};
}
