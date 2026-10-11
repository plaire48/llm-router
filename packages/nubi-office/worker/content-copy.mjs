import {contentObservation} from './content-schema.mjs';

// A template copy is an existing-format document, not an unrestricted draft.
// Host evidence, never a model assertion, transfers the selected write scope.
export function contentCopyReceipt(result, source, host) {
  const fail=()=>{throw new Error('content_copy_mismatch');};
  if(result?.verified!==true||result.copied!==true||result.sourceScopeId!==source.scopeId||result.sourceFingerprint!==source.fingerprint||typeof result.path!=='string'||!result.path||!Array.isArray(result.checks))fail();
  for(const id of ['destination_binding','observed_content','selection_scope']){
    const checks=result.checks.filter(c=>c.id===id);
    if(checks.length!==1||checks[0].status!=='met')fail();
  }
  if(result.checks.some(c=>c.status!=='met'))fail();
  const next=result.snapshot;
  contentObservation(next,host,next?.scopeId);
  if(next.scopeId===source.scopeId||next.documentId===source.documentId||next.created||next.offset!==0||next.total!==source.total||next.copySource?.scopeId!==source.scopeId||next.copySource?.fingerprint!==source.fingerprint)fail();
  return next;
}
