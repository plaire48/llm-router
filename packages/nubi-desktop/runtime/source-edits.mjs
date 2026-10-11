import {diffLines} from 'diff';
import {fail, hash} from './files.mjs';

// Observations belong to one model run. A stale summary or a human opening an
// editor does not count as the model having read the replacement range.
export class SourceObservations {
  files = new Map();
  newPaths = new Map();
  observeMissing(file) {this.newPaths.set(file.path,{hash:file.hash,rulesFingerprint:file.projectRules?.fingerprint});}
  observe(file) {
    let value = this.files.get(file.path);
    if (!value || value.hash !== file.hash) value = {hash: file.hash, ranges: []};
    value.rulesFingerprint=file.projectRules?.fingerprint;
    value.ranges.push([file.start, file.end]);
    value.ranges.sort((a, b) => a[0] - b[0]);
    value.ranges = value.ranges.reduce((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1]);
      else merged.push([...range]);
      return merged;
    }, []);
    this.files.set(file.path, value);
  }
  require(file, start = 1, end = file.lines) {
    const value = this.files.get(file.path);
    if (!value || value.hash !== file.hash || !value.ranges.some(([a, b]) => a <= start && b >= end)) fail('source_read_required');
  }
}

export function replaceObserved(file, expectedHash, edits, observations) {
  if (file.hash !== expectedHash) fail('source_stale');
  if (!Array.isArray(edits) || !edits.length || edits.length > 10) fail('edits_invalid');
  const changes = edits.map(edit => {
    if (!edit || typeof edit.oldText !== 'string' || !edit.oldText || edit.oldText.length > 20000 || typeof edit.newText !== 'string' || edit.newText.length > 20000) fail('edits_invalid');
    const start = file.content.indexOf(edit.oldText);
    if (start < 0) fail('edit_text_missing');
    if (file.content.indexOf(edit.oldText, start + 1) >= 0) fail('edit_text_ambiguous');
    const end = start + edit.oldText.length;
    const line = file.content.slice(0, start).split('\n').length;
    const lastLine = file.content.slice(0, end - 1).split('\n').length;
    observations.require(file, line, lastLine);
    return {start, end, text: edit.newText};
  }).sort((a, b) => a.start - b.start);
  if (changes.some((change, index) => index && change.start < changes[index - 1].end)) fail('edits_overlap');
  let content = file.content;
  for (const change of changes.reverse()) content = content.slice(0, change.start) + change.text + content.slice(change.end);
  if (hash(content) === file.hash) fail('edit_no_change');
  return content;
}

export function summarizeDiff(before, after) {
  // Bounded work: a large rewrite may be reviewable even if the count is unknown.
  const parts = diffLines(before, after, {timeout: 100, maxEditLength: 5000});
  if (!parts) return {state: 'unavailable'};
  return {state: 'counted', added: parts.filter(p => p.added).reduce((sum, p) => sum + p.count, 0), removed: parts.filter(p => p.removed).reduce((sum, p) => sum + p.count, 0)};
}
