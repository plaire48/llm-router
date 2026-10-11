// Native previews use UTF-16 offsets. Generic truncation may describe notes.
export function contentFieldIncomplete(item,field){
  const value=item[field],length=item[field+'Length'];
  if(typeof value!=='string')return false;
  if(Number.isInteger(length)&&length>value.length)return true;
  if(field==='notes')return item.notesTruncated===true;
  return item.truncated===true&&item.notesTruncated!==true||
    item.kind==='field'&&value.length>=4000&&item.truncated===undefined&&length===undefined;
}
export function contentTextIncomplete(item){return ['text','notes'].some(field=>contentFieldIncomplete(item,field));}
export function validateContentText(item){
  for(const key of ['truncated','notesTruncated'])if(item[key]!==undefined&&typeof item[key]!=='boolean')throw new Error('observation_invalid');
  for(const field of ['text','notes']){
    const value=item[field],length=item[field+'Length'],hash=item[field+'Hash'];
    const flag=field==='notes'?item.notesTruncated:item.notesTruncated===true?undefined:item.truncated;
    if(length!==undefined&&(!Number.isSafeInteger(length)||typeof value!=='string'||length<value.length||flag===false&&length!==value.length||flag===true&&length<=value.length))throw new Error('observation_invalid');
    if(hash!==undefined&&(typeof hash!=='string'||! /^[a-f0-9]{64}$/.test(hash)))throw new Error('observation_invalid');
  }
}
