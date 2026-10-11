import {collectSnapshot} from './generated/browser-dom.js';
import {pageScript} from './page-script.js';
import {observedDocumentScope} from './browser-observation.js';

// Read-only references use a separate namespace and node cache. They never
// bind a click target, create an action ref, navigate or broaden frame access.
export async function readObservedPageRegion(task, args, safeURL, cancelled = () => false) {
  if (!args || args.mode !== 'region' || typeof args.region_ref !== 'string' ||
      !/^r-[a-f0-9-]{36}-[0-9]+$/.test(args.region_ref) || Object.keys(args).some(key => !['mode', 'region_ref'].includes(key))) throw Error('region_arguments_invalid');
  const check = () => {if (cancelled()) throw Error('cancelled');};
  check();
  const observed = task.latestObservation;
  const frames = observed?.frames?.filter(frame => frame.retrieval?.textRegions?.some(region => region.region_ref === args.region_ref)) || [];
  if (observed?.tabId !== task.tabId || !observed.topDocumentId || frames.length !== 1 || !frames[0].documentId) throw Error('region_stale');
  const frame = frames[0], documentId = frame.documentId;
  const regions = frame.retrieval.textRegions.filter(region => region.region_ref === args.region_ref);
  if (regions.length !== 1 || !Number.isSafeInteger(regions[0].index) || regions[0].index < 0) throw Error('region_stale');
  const currentScope = async () => {
    check();
    const scope = await observedDocumentScope(task.tabId); check();
    const records = scope.filter(record => record.documentId === documentId);
    if (scope.find(record => record.frameId === 0)?.documentId !== observed.topDocumentId || records.length !== 1 ||
        !Number.isSafeInteger(records[0].frameId) || records[0].frameId < 0 ||
        (safeURL(records[0].result?.url) || (['about:blank', 'about:srcdoc'].includes(records[0].result?.url) ? observed.url : null)) !== frame.url) throw Error('region_stale');
    return records[0];
  };
  const before = await currentScope();
  let data;
  if (task.observedDocuments?.has(documentId)) {
    const records = await pageScript({target: {tabId: task.tabId, documentIds: [documentId]}, world: 'ISOLATED',
      func: collectSnapshot, args: [{region_ref: args.region_ref}]}).catch(() => {check(); throw Error('region_stale');});
    check();
    if (records.length !== 1 || records[0].documentId !== documentId) throw Error('region_stale');
    data = records[0].result;
  } else if (task.app && task.page) {
    const target = task.page.frames()[frame.frame];
    if (!target || target.isDetached() || target.url() !== before.result.url) throw Error('region_stale');
    // Opaque region_ref must exist in this exact frame's latest collector
    // cache; even a same-URL sibling frame cannot satisfy it.
    data = await target.evaluate(collectSnapshot, {region_ref: args.region_ref}).catch(() => {check(); throw Error('region_stale');});
    check();
  } else throw Error('region_stale');
  if (!data || data.error || data.region_scope?.region_ref !== args.region_ref || data.region_scope?.read_only !== true || data.region_scope?.region_index !== regions[0].index) throw Error(data?.error === 'region_arguments_invalid' ? data.error : 'region_stale');
  const after = await currentScope();
  if (after.frameId !== before.frameId || after.result.url !== before.result.url) throw Error('region_stale');
  const {elements: _nodes, descriptors: _actions, ...details} = data;
  return {ok: true, dataKind: 'page_region', tabId: task.tabId, topDocumentId: observed.topDocumentId,
    title: observed.title, url: observed.url, region_scope: details.region_scope,
    frames: [{...details, frame: frame.frame, documentId, url: frame.url, ...(frame.owner ? {owner: frame.owner} : {}), elements: []}],
    scope: 'Read-only reread of one previously observed region in the same document. Other regions were not read. Original node/text budgets and privacy exclusions apply. This is not a full-page observation or action authority.'};
}
