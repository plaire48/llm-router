// Admission IDs bind the source selection as well as the message text.
// Compare source identities, not client-provided titles or display metadata.
export function sameMailReferences(left=[],right=[]){
  if(!Array.isArray(left)||!Array.isArray(right))return false;
  const identity=item=>item&&[item.id,item.sourceHash,item.attachmentId||null,item.attachmentHash||null,item.location?.page||null,item.location?.slide||null,item.location?.sheet||null,item.scope||null];
  return JSON.stringify(left.map(identity))===JSON.stringify(right.map(identity));
}
export async function validateMailReferences(service,references=[]){
  if(!Array.isArray(references)||references.length>20)throw Error('mail_input_invalid');
  const observed=[];
  for(const reference of references){
    if(!reference||typeof reference!=='object')throw Error('mail_input_invalid');
    const value=await service.mail({...reference,action:'evidence'});
    if(!observed.some(item=>item.id===value.id&&item.attachmentId===value.attachmentId&&JSON.stringify(item.location)===JSON.stringify(value.location)))observed.push(value);
  }
  return observed;
}
export function mergeMailReferences(previous=[],references=[]){
  const merged=[...previous];
  for(const reference of references){const index=merged.findIndex(item=>item.id===reference.id&&item.attachmentId===reference.attachmentId&&JSON.stringify(item.location)===JSON.stringify(reference.location));if(index<0)merged.push(reference);else merged[index]=reference;}
  return merged.slice(-20);
}
