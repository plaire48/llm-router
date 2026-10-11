import {truncateHead} from '@earendil-works/pi-coding-agent';

// Pi's line reader normally handles paging. Long JSON lines need a bounded
// alternative because its shell fallback is deliberately unavailable in Office.
export function characterPage(text,{charOffset=0,charLimit=4000}={}){
  const characters=Array.from(text);
  if(!Number.isSafeInteger(charOffset)||charOffset<0||charOffset>characters.length||!Number.isSafeInteger(charLimit)||charLimit<1)throw new Error('tool_arguments_invalid');
  let end=charOffset,bytes=0;
  while(end<characters.length&&end-charOffset<Math.min(charLimit,4000)){
    const size=Buffer.byteLength(characters[end]);if(bytes+size>12000)break;
    bytes+=size;end++;
  }
  return{readMode:'characters',content:characters.slice(charOffset,end).join(''),charOffset,readChars:end-charOffset,totalChars:characters.length,
    truncated:end<characters.length,...(end<characters.length?{nextCharOffset:end}:{})};
}

// Keep SDK presentation notices out of evidence and cursor arithmetic. Pi still
// owns complete-line truncation; only raw source determines continuation.
export function linePage(text,{offset=1,limit=80}={}){
  const lines=text.split('\n');
  if(!Number.isSafeInteger(offset)||offset<1||offset>lines.length||!Number.isSafeInteger(limit)||limit<1)throw new Error('tool_arguments_invalid');
  const start=offset-1,wanted=Math.min(start+Math.min(limit,120),lines.length);
  const selected=lines.slice(start,wanted).join('\n');
  // Reserve one byte for the original separator before the next line.
  const bounded=truncateHead(selected,{maxLines:120,maxBytes:11999});
  const prefix=start?lines.slice(0,start).join('\n')+'\n':'';
  const charOffset=Array.from(prefix).length;
  if(bounded.firstLineExceedsLimit)return characterPage(text,{charOffset});
  const readLines=bounded.truncated?bounded.outputLines:wanted-start,end=start+readLines;
  const endOffset=end<lines.length?lines.slice(0,end).join('\n').length+1:text.length;
  const content=text.slice(prefix.length,endOffset),readChars=Array.from(content).length,truncated=endOffset<text.length;
  return{readMode:'lines',content,offset,readLines,totalLines:lines.length,charOffset,readChars,totalChars:Array.from(text).length,truncated,
    ...(truncated?{nextOffset:end+1,nextCharOffset:charOffset+readChars}:{})};
}
