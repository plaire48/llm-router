// Native Word observations cap text at 4,000 UTF-16 code units. Old hosts did
// not mark truncated content controls: exactly that boundary is ambiguous.
export function contentTextIncomplete(item){
  return item.truncated===true||Number.isInteger(item.textLength)&&typeof item.text==='string'&&item.textLength>item.text.length||
    item.kind==='field'&&typeof item.text==='string'&&item.text.length>=4000&&item.truncated===undefined&&item.textLength===undefined;
}
export function validateContentText(item){
  if(item.truncated!==undefined&&typeof item.truncated!=='boolean')throw new Error('observation_invalid');
  if(item.textLength!==undefined&&(!Number.isSafeInteger(item.textLength)||typeof item.text!=='string'||item.textLength<item.text.length||
    item.truncated===false&&item.textLength!==item.text.length||item.truncated===true&&item.textLength<=item.text.length))throw new Error('observation_invalid');
}
