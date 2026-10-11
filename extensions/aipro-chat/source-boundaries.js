// Lexical navigation candidates, never a verdict about the rule or relevance.
// The reader already holds this full, version-bound text; only offsets leave it.
const patterns = [
  ['exception',/예외|임시\s*휴관|휴관|휴무|공사|잠정|한시|temporary\s+clos(?:ure|ed)|closed|except(?:ion)?/gi],
  ['exclusion',/제외|불가|제한|대상자?|이용\s*자격|exclud(?:e[sd]?|ing)|eligib(?:le|ility)|not\s+(?:eligible|available)|only\s+(?:members|residents)/gi],
  ['condition',/(?:^|\n)\s*(?:단[,，\s]|다만|주의|조건)|unless|subject\s+to|provided\s+that/gi],
  ['period',/(?:19|20)\d{2}\s*년|\b(?:19|20)\d{2}\b|시행일|적용\s*기간|변경\s*일|effective\s+(?:date|from)|valid\s+(?:until|from)/gi],
];
export function sourceBoundaryIndex(text, contentHash) {
  if(typeof text!=='string' || text.length<=5000)return undefined;
  const rows=new Map();let total=0;
  for(const [kind,pattern] of patterns) {
    const first=[],last=[];pattern.lastIndex=0;
    for(const match of text.matchAll(pattern)) {
      total++;const at=match.index;
      const left=Math.max(0,at-120),right=Math.min(text.length,at+match[0].length+180);
      const before=text.slice(left,at),after=text.slice(at,right),newline=after.indexOf('\n');
      const start=left+before.lastIndexOf('\n')+1,end=newline<0?right:at+newline;
      let readOffset=Math.max(0,start-600);
      if(/[\uDC00-\uDFFF]/.test(text[readOffset]) && /[\uD800-\uDBFF]/.test(text[readOffset-1]))readOffset++;
      const row={start,end,read_offset:readOffset,kinds:[kind]};
      if(first.length<3)first.push(row);
      last.push(row);if(last.length>3)last.shift();
    }
    for(const row of [...first,...last]) {
      const key=`${row.start}:${row.end}`,existing=rows.get(key);
      if(existing){if(!existing.kinds.includes(kind))existing.kinds.push(kind);}
      else rows.set(key,row);
    }
  }
  if(!rows.size)return undefined;
  const anchors=[...rows.values()].sort((a,b)=>a.start-b.start);
  let represented=0;
  for(const [,pattern] of patterns) {pattern.lastIndex=0;for(const match of text.matchAll(pattern))if(anchors.some(row=>row.start<=match.index&&row.end>=match.index+match[0].length))represented++;}
  return {content_hash:contentHash,method:'lexical_navigation',total_keyword_matches:total,omitted_keyword_matches:total-represented,anchors,
    scope:'Offsets of literal rule/exception/exclusion/date keywords in the selected source text, not facts or relevance verdicts and not proof these ranges were returned or understood. For a relevant requested condition, read with this content_hash, no query and offset=read_offset. Only actual returned ranges support citations. Irrelevant terms do not create new requirements; Counts are keyword occurrences, not unique sections. Omitted keyword matches remain unknown.'};
}
