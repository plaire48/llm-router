import {rankEvidence, evidenceExcerpt} from './evidence-search.js';

// Candidates come only from the sanitized observation already returned to the
// model. Similarity never changes a failed exact check into a pass.
export function verificationTextFeedback(checks, results, observation) {
  const documents = [];
  for (const frame of (observation?.frames || []).slice(0, 16)) {
    if (frame.unavailable || !Number.isSafeInteger(frame.frame) || !frame.documentId || typeof frame.text !== 'string') continue;
    for (const text of frame.text.slice(0, 16000).split('\n').filter(text => text.trim())) {
      if (documents.length >= 400) break;
      documents.push({id: documents.length, text, frame: frame.frame, documentId: frame.documentId});
    }
  }
  return results.filter(result => result.kind === 'text_present' && result.passed === false &&
    Number.isSafeInteger(result.index) && checks[result.index]?.kind === 'text_present').slice(0, 4).map(result => {
    const expected = checks[result.index].expected;
    const hits = typeof expected === 'string' ? rankEvidence(documents, expected).slice(0, 2) : [];
    return {checkIndex: result.index, reason: 'text_not_observed', candidates: hits.map(hit => {
      const source = documents[hit.id];
      return {frame: source.frame, documentId: source.documentId, text: evidenceExcerpt(source.text, expected, 320),
        partial: true, candidateOnly: true};
    }), instruction: 'Partial visible-text candidates from the returned observation, not matches or proof. Compare literal wording and source context with the original requirement. Correct an erroneous check or inspect missing scope; never weaken a real requirement or replay input. Failed checks require a new exact verification.'};
  });
}
