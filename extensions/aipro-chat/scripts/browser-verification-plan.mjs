import {QUALITY_AREAS} from './quality-scorecard.mjs';

export const QUALITY_PROFILE = 'quality-baseline-v8';
export const QUALITY_ONCE = ['resume-target-browser', 'action-pressure-browser', 'analysis-backpressure-browser', 'read-loop-recovery-browser', 'final-gap-recovery-browser', 'agent-diagnostic-journal-browser', 'research-source-browser', 'browser-dom-actionability-browser', 'wiki-quality-browser', 'prompt-shortcuts-browser', 'restart-write-browser', 'native-dialog-approval-browser', 'webarena-har-browser',
  'openwiki-agent-browser', 'wiki-folder-persistence-browser', 'analysis-retention-browser', 'evaluation-evidence-browser',
  'large-document-browser', 'trace-journal-browser', 'browser-policy-browser'];

// Keep the baseline tied to the existing graders, plus the Wiki delegation and
// evidence-lifetime regressions that the eight-area scorecard does not cover.
export const QUALITY_BASELINE = [...new Set([
  ...QUALITY_AREAS.flatMap(area => area.suites),
  'source-reference-browser', 'harness-seven-browser', 'review-recovery-browser', 'script-recovery-browser', 'browser-routines-browser', 'browser-diagnostics-browser', 'wiki-search-browser', 'subagent-progress-browser',
  'uncertain-frame-browser', 'full-page-captures-browser', 'capture-coverage-browser',
  ...QUALITY_ONCE,
])];

export function browserVerificationPlan({args = [], suiteFilter, repeated, once, repeats}) {
  if (args.some(arg => arg !== '--quality') || args.length > 1) throw new Error('Unknown or duplicate verification option');
  const quality = args.includes('--quality');
  if (quality && suiteFilter !== undefined) throw new Error('Clear NUBI_TEST_SUITES before running the fixed quality baseline');
  const selected = quality ? QUALITY_BASELINE : suiteFilter === undefined ? null : suiteFilter.split(',').map(value => value.trim()).filter(Boolean);
  if (selected && (!selected.length || new Set(selected).size !== selected.length)) throw new Error('NUBI_TEST_SUITES must contain unique, non-empty suite names');
  const catalog = [...repeated, ...once];
  if (selected?.some(name => !catalog.includes(name))) throw new Error('Verification selection contains an unknown browser suite');
  return {
    profile: quality ? QUALITY_PROFILE : selected ? 'selected' : 'full',
    selection: selected || catalog,
    fullMatrix: selected === null && repeats >= 3,
    selected,
  };
}
