import {createResearchHandoff} from './research-handoff.js';
import {QuestionInput, runWikiQuestion} from '../../packages/openwiki/src/agent/wiki-question.ts';
import {NubiOpenWikiModel, isWikiAuthenticationError, createResearchProgress} from './openwiki-agent.js';
import {createWikiQuestionSearch} from './openwiki-retrieval.js';

// The host supplies only this conversation's selected attachments. Reuse the
// same read-only DeepAgents core without inventing a Wiki identity for files.
export async function delegateDocumentQuestion(args, {complete, execute, signal, modelId, onStep = () => {}, researchHandoffs, onResearchHandoff}) {
  signal.throwIfAborted();
  if(args?.restart_research!==undefined&&typeof args.restart_research!=='boolean')throw Error('tool_arguments_invalid');
  if (typeof args?.question !== 'string' || !args.question.trim() || args.question.length > 4000 ||
    !Array.isArray(args.document_ids) || !args.document_ids.length || args.document_ids.length > 8 ||
    new Set(args.document_ids).size !== args.document_ids.length || args.document_ids.some(id => typeof id !== 'string' || !id || id.length > 80)) throw new Error('tool_arguments_invalid');
  // Freeze the caller's scope so an in-flight UI update cannot change the final recheck.
  const request = structuredClone({question: args.question, document_ids: args.document_ids});
  const snapshot = await execute('ask_documents', request);
  signal.throwIfAborted();
  if (snapshot?.error) return snapshot;
  const parseSnapshot = value => {
    if (value?.dataKind !== 'document_snapshot' || value.sourceComplete !== true || !Array.isArray(value.documents) ||
      value.documents.length !== request.document_ids.length || value.documents.some(doc => doc.kind !== 'document' || !request.document_ids.includes(doc.id) || !/^[a-f0-9]{64}$/.test(doc.version || ''))) throw new Error('attachment_missing');
    return QuestionInput.parse({question: request.question, documents: value.documents, sourceComplete: true});
  };
  const input = parseSnapshot(snapshot);
  const taskId = `documents-${crypto.randomUUID()}`;
  const progress = createResearchProgress({taskId, task: request.question, documents: input.documents, onStep});
  const authentication = new AbortController();
  const researchSignal = AbortSignal.any([signal, authentication.signal]);
  const guardedComplete = async (...parameters) => {
    researchSignal.throwIfAborted();
    try {return await complete(...parameters);}
    catch (error) {if (isWikiAuthenticationError(error)) authentication.abort(error); throw error;}
  };
  const model = new NubiOpenWikiModel({complete: guardedComplete, signal: researchSignal, modelId, taskId});
  const handoff=await createResearchHandoff({kind:"documents",owner:JSON.stringify([...request.document_ids].sort()),question:request.question,modelId,handoffs:args.restart_research?undefined:researchHandoffs,onHandoff:onResearchHandoff});
  try {
    const result = await runWikiQuestion(input, {signal: researchSignal, model, modelId, search: createWikiQuestionSearch(), onProgress: progress.progress,...handoff});
    const current = parseSnapshot(await execute('ask_documents', request));
    signal.throwIfAborted();
    const documents = new Map(current.documents.map(doc => [doc.id, doc]));
    if (input.documents.some(original => {
      const doc = documents.get(original.id);
      return !doc || ['text', 'version', 'title', 'path', 'kind'].some(key => original[key] !== doc[key]);
    })) throw new Error('attachment_missing');
    await handoff.finish();
    progress.finish(result);
    return {...result, document_ids: [...request.document_ids], dataKind: 'document_reference', advisory: true,
      instruction: 'Attached-document research from immutable, conversation-owned text snapshots. Preserve source file identity, hash, ranges, coverage and uncertainties. PDF/DOCX text excludes images, layout and OCR. This is advice, not live browser evidence, approval or execution.'};
  } catch (error) {
    if(error?.message==='research_checkpoint_changed'){progress.fail();return {error:'research_checkpoint_changed',instruction:'The authorized source snapshot changed. Reconcile the original goal with the current source, then call this tool with restart_research=true for a fresh plan. No historical answer was delivered.'};}
    progress.fail({cancelled: signal.aborted});
    throw signal.aborted ? error : authentication.signal.reason || error;
  }
}
