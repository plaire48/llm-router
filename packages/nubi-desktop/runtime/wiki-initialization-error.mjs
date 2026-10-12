const safeCodes=new Set(['git_access_denied','git_timeout','git_history_failed','git_unsafe_directory','wiki_interrupted','source_stale','provider_changed','wiki_git_required','wiki_source_limit','wiki_no_sources','wiki_empty','unauthorized','expired_token','response_invalid','model_unavailable','model_missing','context_length_exceeded','rate_limited','network_error','timeout','path_scope','project_changed','write_unconfirmed','tls_untrusted','tls_expired','tls_hostname','network_dns','network_refused','forbidden','no_credential','output_limit','response_json_invalid','model_failed']);
// The transport names a lost connection 'network' and a late answer 'model_timeout' (recovery.mjs); the view names the codes above (2026-10-12).
const transport={network:'network_error',model_timeout:'timeout',network_timeout:'timeout'};
export function wikiInitializationError(error,stage){
  const code=transport[error?.message]||error?.message;
  if(safeCodes.has(code))return code;
  if(['EACCES','EPERM'].includes(error?.code))return 'wiki_permission_denied';
  if(error?.code==='ENOSPC')return 'wiki_disk_full';
  if(error?.code==='EEXIST')return 'wiki_output_conflict';
  if(stage==='snapshot_git')return error?.code==='ENOENT'?'wiki_git_required':error?.killed?'wiki_git_timeout':'wiki_snapshot_failed';
  if(error?.code==='ENOENT')return 'wiki_source_missing';
  if(error?.killed||error?.name==='TimeoutError')return 'timeout';
  return 'wiki_failed';
}
