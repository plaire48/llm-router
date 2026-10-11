// Model chunks are drafts, never Excel operations. Validation is atomic at
// commit; a malformed chunk cannot discard the previously accepted draft.
const layout=['formats','merges','columnWidths','rowHeights','borders','page'];
export function mergeDocumentChunk(previous,chunk,name) {
  const fail=()=>{throw new Error('document_schema_invalid');};
  if(!chunk||Array.isArray(chunk)||typeof chunk!=='object'||Object.keys(chunk).some(k=>!['name','address','cells','removeCells',...layout].includes(k))||chunk.name!==undefined&&chunk.name!==name)fail();
  if(JSON.stringify(chunk).length>12000||chunk.cells!==undefined&&(!Array.isArray(chunk.cells)||chunk.cells.length>24)||chunk.removeCells!==undefined&&(!Array.isArray(chunk.removeCells)||chunk.removeCells.length>24))fail();
  const next=structuredClone(previous||{name,cells:[]});
  const address=value=>{if(typeof value!=='string'||!/^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}$/i.test(value))fail();return value.replaceAll('$','').toUpperCase();};
  const cells=new Map(next.cells.map(c=>[address(c.address),c]));
  for(const key of chunk.removeCells||[])cells.delete(address(key));
  for(const cell of chunk.cells||[]){if(!cell||typeof cell!=='object')fail();const key=address(cell.address);cells.set(key,{...cell,address:key});}
  next.cells=[...cells.values()];
  if(chunk.address!==undefined)next.address=chunk.address;
  for(const key of layout)if(Object.hasOwn(chunk,key))next[key]=structuredClone(chunk[key]);
  if(next.cells.length>1000||JSON.stringify(next).length>60000)fail();return next;
}
