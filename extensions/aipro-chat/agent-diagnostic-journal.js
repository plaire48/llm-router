import {createTraceJournal, journalDatabase} from './trace-journal.js';
import {agentDiagnostic} from './completion-errors.js';

export const AGENT_DIAGNOSTIC_LIMITS = Object.freeze({perRun: 400, total: 10000, runs: 256, page: 50});
export const createAgentDiagnosticJournal = (options = {}) => createTraceJournal({
  open: journalDatabase('nubi-agent-diagnostics'), limits: AGENT_DIAGNOSTIC_LIMITS, ...options,
  eventFor: agentDiagnostic, autoSequence: true,
});
export const agentDiagnosticJournal = createAgentDiagnosticJournal();
