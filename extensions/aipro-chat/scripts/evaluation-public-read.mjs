// Opt-in evaluator artifact for the fixed public task pages only. Never used
// in the product logger. The caller supplies origin/path pairs from that plan.
export function evaluationPublicRead(result, allowedPages = []) {
  if (!result || result.error || result.ok === false || result.metadata_only) return null;
  let url;
  try {url = new URL(result.url);} catch {return null;}
  if (url.protocol !== 'https:' || url.username || url.password ||
      !allowedPages.includes(url.origin + url.pathname) || /(?:auth|login|callback)/i.test(url.pathname) ||
      [...url.searchParams.keys()].some(key => /token|code|secret|session|auth|key/i.test(key))) return null;
  const value = {url:url.origin + url.pathname, scope:'Sanitized public tool result, not the entire model input'};
  if (result.dataKind === 'page_content') {
    if (result.ok !== true) return null;
    return {...value, documentId:result.source_document_id, contentHash:result.content_hash,
      ranges:(result.ranges || []).slice(0,2).map(row => ({start:row.start,end:row.end,
        markdown:String(row.markdown || '').slice(0,5000), captureTruncated:String(row.markdown || '').length>5000}))};
  }
  if (!Array.isArray(result.frames)) return null;
  // Tables are supplied to the model separately from frame.text. Keep their
  // observed row/column association so a wrong answer can be traced to either
  // source, without retaining element handles, input values or other fields.
  const tableFields = ['name','role','inViewport','observedRows','omittedRows','partial','declaredRows','declaredColumns'];
  const cellFields = ['column','role','text','rowSpan','colSpan','textTruncated','contentOmitted','valueOmitted'];
  const pick = (object, fields) => Object.fromEntries(fields.filter(key => ['string','number','boolean'].includes(typeof object?.[key])).map(key => [key,object[key]]));
  const tables = frame => {
    if (!Array.isArray(frame.tables)) return {};
    const retained=[]; let remaining=12000;
    for (const table of frame.tables.slice(0,6)) {
      const rows=Array.isArray(table.rows) ? table.rows : [];
      const safe={...pick(table,tableFields),...(table.enclosingLink ? {enclosingLink:pick(table.enclosingLink,['relationship','url'])} : {}),captureOmittedRows:Math.max(0,rows.length-8),rows:rows.slice(0,8).map(row=>{
        const cells=Array.isArray(row.cells) ? row.cells : [];
        return {...pick(row,['index','omittedCells']),captureOmittedCells:Math.max(0,cells.length-12),
          cells:cells.slice(0,12).map(cell=>pick(cell,cellFields))};
      })};
      const size=JSON.stringify(safe).length;
      if (size>remaining) break;
      remaining-=size; retained.push(safe);
    }
    return {tables:retained,tableCaptureOmitted:frame.tables.length-retained.length,
      tableCoverage:pick(frame.tableCoverage,['observed','returned','queryFiltered','omitted'])};
  };
  return {...value,frames:result.frames.slice(0,2).filter(frame=>!frame.unavailable).map(frame=>({
    frame:frame.frame,documentId:frame.documentId,text:String(frame.text || '').slice(0,16000),
    ...tables(frame),
    captureTruncated:String(frame.text || '').length>16000,textFiltered:frame.textFiltered===true,truncated:frame.truncated===true}))};
}
