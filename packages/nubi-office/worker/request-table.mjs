// Tables pasted into a request, found by the host so that their rows are written from the user's own text instead of
// being copied out by the model. Measured 2026-09-30 (simulated host, 200 and 320 pasted rows): one model reply that
// copied the rows took 108 to 120 seconds, and gpt-5.6-luna mixed value types or miscounted rows in 2 of 2 runs of
// 320 rows. A table is a run of at least three consecutive lines split by the same delimiter into the same number
// (2 or more) of fields: a tab (copied from Excel), " / " or "|" (a Markdown table; its separator line is skipped).
// A comma is not a delimiter: 1,200 is a number.
const SEPARATOR=/^:?-+:?$/;
function split(line,delimiter){
  if(delimiter==='tab')return line.includes('\t')?line.split('\t').map(field=>field.trim()):null;
  if(delimiter===' / ')return line.includes(' / ')?line.split(' / ').map(field=>field.trim()):null;
  const text=line.trim();if(!text.includes('|'))return null;
  return(text.startsWith('|')&&text.endsWith('|')&&text.length>1?text.slice(1,-1):text).split('|').map(field=>field.trim());
}
export function requestTables(text,{minRows=3,maxTables=5,maxRows=1000}={}){
  if(typeof text!=='string'||!text)return[];
  const lines=text.split('\n').map(line=>line.replace(/\r$/,'')),used=new Set(),tables=[];
  for(const delimiter of ['tab',' / ','|']){
    let run=[];
    const close=()=>{
      const rows=run.filter(row=>!(delimiter==='|'&&row.fields.every(field=>SEPARATOR.test(field))));
      if(rows.length>=minRows&&rows.length<=maxRows&&tables.length<maxTables){for(const row of run)used.add(row.line);tables.push({delimiter,rows});}
      run=[];
    };
    lines.forEach((line,index)=>{
      const fields=used.has(index)?null:split(line,delimiter);
      if(!fields||fields.length<2||fields.every(field=>!field)){close();return;}
      if(run.length&&run[0].fields.length!==fields.length)close();
      run.push({line:index,fields});
    });
    close();
  }
  return tables.sort((a,b)=>a.rows[0].line-b.rows[0].line).map((table,index)=>({table:index+1,delimiter:table.delimiter,
    lines:`${table.rows[0].line+1}-${table.rows.at(-1).line+1}`,rows:table.rows.length,columns:table.rows[0].fields.length,cells:table.rows.map(row=>row.fields)}));
}
// What the executor is shown: the size and the first and last rows, never the whole table again.
export const tableSummary=({cells,...table})=>({...table,first:cells[0].map(field=>field.slice(0,80)),last:cells.at(-1).map(field=>field.slice(0,80))});
