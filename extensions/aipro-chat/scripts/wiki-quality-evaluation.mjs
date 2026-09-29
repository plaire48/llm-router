import {createHash} from 'node:crypto';
import {createWikiQuestionSearch} from '../openwiki-retrieval.js';

export const textHash = text => createHash('sha256').update(text).digest('hex');
const contains = (outer, inner) => outer.documentId === inner.documentId && outer.start <= inner.start && outer.end >= inner.end;
const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

// Retrieval measures source coverage, not the truth of a generated answer.
export function gradeWikiRetrieval(task, hits, topK = 8) {
  const selected = hits.slice(0, topK);
  const ranges = selected.flatMap(hit => [hit, ...(hit.contextRanges || []).map(range => ({...range, documentId: hit.documentId}))]);
  const documents = new Set(task.expected.map(fact => fact.documentId));
  const foundDocuments = new Set(selected.map(hit => hit.documentId));
  const found = task.expected.filter(fact => ranges.some(range => contains(range, fact)));
  const first = selected.findIndex(hit => task.expected.some(fact => contains(hit, fact) || (hit.contextRanges || []).some(range => contains({...range, documentId:hit.documentId}, fact))));
  return {topK, retrieved: selected.length, expectedFacts: task.expected.length, foundFacts: found.length,
    documentRecall: documents.size ? [...documents].filter(id => foundDocuments.has(id)).length / documents.size : null,
    referenceRangeRecall: task.expected.length ? found.length / task.expected.length : null,
    reciprocalRank: task.expected.length ? first < 0 ? 0 : 1 / (first + 1) : null,
    // Negative cases may retrieve related background; this is not an answer.
    noAnswerCase: !task.expected.length,
    passed: task.expected.length ? found.length === task.expected.length : task.retrievalExpectation === 'empty' ? selected.length === 0 : null};
}

export function gradeWikiAnswer(task, result) {
  const problems = [];
  if (result?.wikiId !== task.snapshot.wikiId || result?.wiki !== task.wiki) problems.push('wrong_wiki');
  if (!['complete', 'partial', 'blocked'].includes(result?.status) || typeof result?.answer !== 'string' || !Array.isArray(result?.findings) || !Array.isArray(result?.evidence) || !Array.isArray(result?.uncertainties))
    return {passed: false, problems: [...problems, 'invalid_result'], referenceCoverage: 0, answerFactMatch: 0, semanticFaithfulness: null};
  const ids = new Set(), valid = new Map();
  for (const evidence of result.evidence) {
    if (!evidence || typeof evidence !== 'object') {problems.push('invalid_evidence'); continue;}
    const doc = task.snapshot.documents.find(doc => doc.id === evidence.documentId);
    const isValid = typeof evidence.id === 'string' && evidence.id && !ids.has(evidence.id) && doc &&
      evidence.hash === textHash(doc.text) && evidence.version === doc.version && evidence.path === doc.path && evidence.kind === doc.kind && evidence.unit === 'utf16' &&
      Number.isSafeInteger(evidence.start) && Number.isSafeInteger(evidence.end) && evidence.start >= 0 && evidence.end > evidence.start && evidence.end <= doc.text.length &&
      evidence.excerpt === doc.text.slice(evidence.start, evidence.end);
    ids.add(evidence.id);
    if (!isValid) problems.push('invalid_evidence'); else valid.set(evidence.id, evidence);
  }
  const cited = [];
  for (const finding of result.findings) {
    if (!finding || typeof finding.text !== 'string' || !finding.text.trim() || !Array.isArray(finding.citations) || !finding.citations.length || finding.citations.some(id => !valid.has(id))) problems.push('invalid_citation');
    else cited.push(...finding.citations.map(id => valid.get(id)));
  }
  const supported = task.expected.filter(fact => cited.some(evidence => contains(evidence, fact)));
  const answerFacts = task.expected.filter(fact => !fact.answers.length || fact.answers.some(answer => normalize(result.answer).includes(normalize(answer))));
  const noAnswer = !task.expected.length;
  if (noAnswer) {
    if (result.status !== 'blocked' || result.findings.length || !result.uncertainties.some(value => typeof value === 'string' && value.trim())) problems.push('missing_abstention');
  } else {
    if (supported.length !== task.expected.length) problems.push('missing_reference');
    if (answerFacts.length !== task.expected.length) problems.push('missing_answer_fact');
    if (result.status !== 'complete') problems.push('incomplete_answer');
  }
  return {passed: problems.length === 0, problems: [...new Set(problems)],
    referenceCoverage: noAnswer ? null : supported.length / task.expected.length,
    answerFactMatch: noAnswer ? null : answerFacts.length / task.expected.length,
    abstained: noAnswer ? result.status === 'blocked' && !result.findings.length : null,
    // Exact ranges / fact tokens do NOT prove entailment or absence of other
    // hallucinations. Human or independently calibrated semantic grading remains.
    semanticFaithfulness: null};
}

export function evaluateWikiRetrieval(dataset) {
  const cases = dataset.cases.map(task => {
    const started = performance.now();
    const hits = createWikiQuestionSearch()(task.question, task.snapshot.documents);
    return {id: task.id, wiki:task.wiki, ...gradeWikiRetrieval(task, hits), durationMs: performance.now() - started, hits: hits.slice(0, 8)};
  });
  return {datasetVersion: dataset.version, datasetSha256: textHash(JSON.stringify(dataset)),
    kind:'offline-wiki-retrieval', actualModel:false, modelCapabilityScore:null,
    cases, passed: cases.every(row => row.passed !== false), assessed:cases.filter(row => row.passed !== null).length,
    documentRecall: mean(cases.map(row => row.documentRecall).filter(value => value !== null)),
    referenceRangeRecall: mean(cases.map(row => row.referenceRangeRecall).filter(value => value !== null)),
    meanReciprocalRank: mean(cases.map(row => row.reciprocalRank).filter(value => value !== null))};
}

export function gradeWikiAnswers(dataset, capture) {
  if (capture?.datasetSha256 !== textHash(JSON.stringify(dataset)) || !Array.isArray(capture?.cases)) throw new Error('wiki_evaluation_dataset_mismatch');
  const cases = dataset.cases.map(task => {
    const records = capture.cases.filter(row => row.id === task.id);
    return {id:task.id, ...(records.length === 1 ? gradeWikiAnswer(task, records[0].result) : {passed:false, problems:['missing_or_duplicate_case']})};
  });
  if (capture.cases.some(row => !dataset.cases.some(task => task.id === row.id))) throw new Error('wiki_evaluation_unknown_case');
  return {kind:'wiki-answer-artifact-grading', datasetVersion:dataset.version, datasetSha256:capture.datasetSha256,
    actualModel:false, agentRunVerified:false, modelCapabilityScore:null, semanticFaithfulness:null,
    cases, passed:cases.every(row => row.passed)};
}
