// Literal search over stored conversation text, independent of the model context window.
export function conversationText(content) {
  if(typeof content==='string')return content.normalize('NFC');
  if(Array.isArray(content))return content.filter(part=>['text','input_text','output_text'].includes(part?.type)&&typeof part.text==='string').map(part=>part.text).join('\n').normalize('NFC');
  return '';
}
export function highlightParts(text,query) {
 const source=String(text||''),term=String(query||'').trim().normalize('NFC');
 if(!term)return [{text:source,match:false}];
 const pattern=new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu'),parts=[];let start=0;
 for(const match of source.matchAll(pattern)){if(match.index>start)parts.push({text:source.slice(start,match.index),match:false});parts.push({text:match[0],match:true});start=match.index+match[0].length;}
 if(start<source.length)parts.push({text:source.slice(start),match:false});return parts;
}
function excerpt(text,query){
 const compact=text.replace(/\s+/g,' ').trim(),at=compact.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()),start=Math.max(0,at-18),end=Math.min(compact.length,Math.max(at,0)+query.length+75);
 return (start?'… ':'')+compact.slice(start,end)+(end<compact.length?' …':'');
}
export function searchConversations(tasks,{query='',offset=0,limit=50}={}) {
 const term=String(query).trim().normalize('NFC');if(term.length>500||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('conversation_search_invalid');
 const rows=[];
 for(const task of tasks){
  const title=conversationText(task.request),messages=(task.messages||[]).flatMap((message,index)=>['user','assistant'].includes(message.role)?[{role:message.role,index,text:conversationText(message.content)}]:[]);
  const matches=term?messages.filter(message=>message.text.toLocaleLowerCase().includes(term.toLocaleLowerCase())):[];
  if(term&&!title.toLocaleLowerCase().includes(term.toLocaleLowerCase())&&!matches.length)continue;
  const match=matches[0]||(term?{role:'request',index:-1,text:title}:null);
  rows.push({id:task.id,request:title,state:task.state,createdAt:task.createdAt,updatedAt:task.updatedAt,...(match?{match:{role:match.role,messageIndex:match.index,snippet:excerpt(match.text,term),count:Math.max(1,matches.length)}}:{})});
 }
 rows.sort((a,b)=>(Date.parse(b.updatedAt||b.createdAt)||0)-(Date.parse(a.updatedAt||a.createdAt)||0));
 return {items:rows.slice(offset,offset+limit),total:rows.length,offset,hasMore:offset+limit<rows.length};
}
