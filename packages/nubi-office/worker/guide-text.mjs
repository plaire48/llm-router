// Guide text of company forms: the marks a form leaves where a value goes (○○○, OOO, 20XX. XX. XX., [제목을 입력하세요],
// (내용 기재), 0,000,000, 홍길동). A span of one of these shapes is replaced when the form is filled; a real value (a name,
// a date with digits, an amount such as 1,100,000) is not guide text. Used by the Word parts (content-schema.mjs) and the
// template map and graders (S1).
export const GUIDE_PATTERNS=[
  /[○◯●]{2,}/gu,
  /(?<![A-Za-z])O{3,}(?![A-Za-z])/gu,
  /(?<!\d)20XX(?:[. -]+X{1,2}){0,2}\.?/gu,
  /(?<![A-Za-z])X{2,}(?:[-. ]X+)*(?![A-Za-z])/gu,
  // Placeholder amounts and dates written with zeros; the zeros of a real number (1,100,000) are not.
  /(?<![\d,])0{1,3}(?:,0{3})+(?![\d,])/gu,
  /(?<![\d.,-])0{2,}(?:[.-]0{2,})+(?![\d])/gu,
  /(?<![\d,.])0{3,}(?![\d,])/gu,
  /\[[^\]\n]{0,40}(?:입력|기재|작성|선택)[^\]\n]{0,20}\]/gu,
  /\([^)\n]{0,40}(?:입력|기재|작성)[^)\n]{0,20}\)/gu,
  /홍길동/gu
];
// The guide spans of a text, left to right; a span inside a longer one is left out.
export function guideSpans(text){
  const spans=[];
  for(const pattern of GUIDE_PATTERNS)for(const match of String(text??'').matchAll(pattern))spans.push({start:match.index,end:match.index+match[0].length,text:match[0]});
  spans.sort((a,b)=>a.start-b.start||b.end-a.end);
  return spans.filter((span,i)=>!spans.some((other,j)=>j!==i&&other.start<=span.start&&other.end>=span.end&&(other.end-other.start>span.end-span.start||j<i)));
}
// The places a value goes, left to right: guide spans, with the pieces of one date guide joined (20XX년 XX월 XX일, XX.
// XX.) and two dates joined into a period (20XX. XX. XX. ~ XX. XX., …부터 …까지). Measured 2026-10-01 (review of
// plan 2): the pieces became slots of their own, labelled "작성일: 20XX년", that Word could not write.
const PIECE=/^(?:20XX|X{1,2}|0{2,4})$/,PIECE_GAP=/^\s*(?:년|월|\.|-|\/)\s*$/,PIECE_END=/^\s*(?:일(?![가-힣])|\.)/;
const DATE=/20XX|0{4}[-.]\s*0{2}|^X{2}\s*(?:[.월/-]\s*X{2})\s*(?:[.일])?$/;
export function valueSpans(text){
  const value=String(text??''),out=[];
  for(const span of guideSpans(value)){
    const last=out.at(-1),gap=last&&value.slice(last.end,span.start);
    if(last&&(PIECE.test(last.text)||last.kind==='date')&&PIECE.test(span.text)&&PIECE_GAP.test(gap)){
      last.end=span.end;last.kind='date';
    }else out.push({start:span.start,end:span.end,text:span.text,...(DATE.test(span.text)?{kind:'date'}:{})});
    const now=out.at(-1);
    if(now.kind==='date'&&now.end-now.start>span.end-span.start){const end=PIECE_END.exec(value.slice(now.end));if(end)now.end+=end[0].length;}
    now.text=value.slice(now.start,now.end);
  }
  // A lone XX piece is not a date ("XX팀"); a joined one is.
  for(const span of out)if(span.kind==='date'&&!DATE.test(span.text)&&!/[년월.]/.test(span.text))delete span.kind;
  const joined=[];
  for(const span of out){
    const last=joined.at(-1),gap=last&&value.slice(last.end,span.start),until=/^\s*(?:[~∼]|부터)\s*$/.exec(gap??'');
    if(last?.kind==='date'&&span.kind==='date'&&until){
      const end=/부터/.test(gap)&&/^\s*까지/.exec(value.slice(span.end));
      joined[joined.length-1]={start:last.start,end:span.end+(end?end[0].length:0),kind:'period',parts:[last.text,span.text]};
      joined.at(-1).text=value.slice(joined.at(-1).start,joined.at(-1).end);
    }else joined.push(span);
  }
  return joined;
}
// A text that is mostly guide marks: at least 60% of its characters other than spaces are in guide spans.
export function isGuideText(text){
  const value=String(text??'').replace(/\s/g,'');if(!value)return false;
  const covered=guideSpans(text).reduce((n,span)=>n+span.text.replace(/\s/g,'').length,0);
  return covered>0&&covered>=value.length*0.6;
}
