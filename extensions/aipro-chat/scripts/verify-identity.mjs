// Reuse the candidate verifier: build first, then inspect actual extension UI.
// No account calls or publication. Keep this gate portable across host shells.
process.env.NUBI_TEST_SUITES = ['browser-pdf-render-browser', 'browser-pdf-browser', 'vision-routing-browser', 'debug-plan-ui-browser', 'pagination-reference-browser', 'research-source-browser', 'final-gap-recovery-browser', 'evaluation-build-browser', 'workspace-group-browser', 'workspace-flow-browser', 'task-plan-browser', 'review-budget-browser', 'agent-diagnostic-journal-browser', 'composer-add-browser', 'browser-policy-browser', 'trace-journal-browser', 'large-document-browser', 'browser-routines-browser', 'plan-mode-browser', 'browser-wiki-browser', 'workflow-knowledge-browser', 'subagent-progress-browser',
  'ui-simplicity-browser', 'typography-browser', 'accessibility-browser',
  'feedback-browser', 'mascot-browser', 'welcome-browser',
  'question-forms-browser', 'image-choice-browser', 'page-skills-browser', 'native-dialog-approval-browser', 'approval-browser', 'attachments-browser',
  'clipboard-documents-browser', 'captures-browser', 'code-browser',
  'integrations-browser', 'openwiki-ui-browser', 'wiki-folder-browser',
  'provider-switch-browser', 'fabrix-browser', 'a2a-browser', 'conversations-browser',
].join(',');
process.env.NUBI_TEST_REPEATS = '1';
await import('./verify-browser.mjs');
