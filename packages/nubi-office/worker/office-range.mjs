export function region(address){
  const m=/^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})(?::\$?([A-Z]{1,3})\$?([1-9]\d{0,6}))?$/i.exec(address||'');if(!m)throw new Error('invalid_range');
  const col=w=>[...w.toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),r=+m[2],c=col(m[1]),er=+(m[4]||m[2]),ec=col(m[3]||m[1]);
  if(er<r||ec<c||er>1048576||ec>16384||(er-r+1)*(ec-c+1)>1000)throw new Error('invalid_range');return{r,c,rows:er-r+1,cols:ec-c+1};
}
export const inside=(o,i)=>i.r>=o.r&&i.c>=o.c&&i.r+i.rows<=o.r+o.rows&&i.c+i.cols<=o.c+o.cols;
// Models often write "Sheet1!A2". The bound sheet's own name is dropped; any
// other sheet is refused, so a prefix can never redirect a write or a check.
export function localAddress(address,worksheet){
  if(typeof address!=='string'||!address.trim())throw new Error('invalid_range');
  const text=address.trim(),qualified=/^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(text);
  if(!qualified)return text;
  const sheet=(qualified[1]?.replaceAll("''","'")??qualified[2]).trim();
  if(typeof worksheet!=='string'||sheet.toLowerCase()!==worksheet.toLowerCase())throw Object.assign(new Error('out_of_scope'),{issue:'The address names another worksheet. Only cells of the selected worksheet can be checked or edited; write the address without a sheet name.'});
  return qualified[3].trim();
}
