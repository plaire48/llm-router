const safeCodes=new Set(['wiki_interrupted','source_stale','provider_changed','wiki_git_required','wiki_source_limit','wiki_no_sources','wiki_empty','unauthorized','expired_token','response_invalid','model_unavailable','model_missing','context_length_exceeded','rate_limited','network_error','timeout','path_scope','project_changed','write_unconfirmed']);
export function wikiInitializationError(error,stage){
  if(safeCodes.has(error?.message))return error.message;
  if(['EACCES','EPERM'].includes(error?.code))return 'wiki_permission_denied';
  if(error?.code==='ENOSPC')return 'wiki_disk_full';
  if(error?.code==='EEXIST')return 'wiki_output_conflict';
  if(stage==='snapshot_git')return error?.code==='ENOENT'?'wiki_git_required':error?.killed?'wiki_git_timeout':'wiki_snapshot_failed';
  if(error?.code==='ENOENT')return 'wiki_source_missing';
  if(error?.killed||error?.name==='TimeoutError')return 'timeout';
  return 'wiki_failed';
}
