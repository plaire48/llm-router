// Capability selection never adds permissions: this catalog only contains
// tools already granted to this request by the service worker.
const groups = Object.freeze({
  input: ['fill_form', 'verify_form', 'select_option'],
  interaction: ['drag_element', 'click_element', 'hover_element', 'press_key', 'scroll_page', 'wait_page'],
  navigation: ['navigate_page', 'list_tabs', 'switch_tab', 'go_back'],
  scripts: ['run_playwright'],
  images: ['find_images', 'inspect_images', 'attach_images', 'capture_page', 'click_at'],
  storage: ['list_page_storage', 'read_page_storage'],
  project: ['wiki_query', 'wiki_search', 'wiki_read', 'source_search', 'read_source'],
});
const core = ['search_documents', 'read_document', 'find_skills', 'read_skill', 'request_approval', 'ask_user', 'read_page', 'inspect_dom', 'browser_snapshot', 'capture_page', 'update_plan', 'verify_page', 'delegate_analysis', 'collect_analysis', 'read_analysis_evidence', 'cancel_analysis'];
export const MUTATING_TOOLS = new Set(['drag_element', 'apply_approved_action','fill_form', 'select_option', 'click_element', 'press_key', 'navigate_page', 'switch_tab', 'go_back', 'run_playwright', 'click_at']);
const viewActions = new Set(['hover', 'scroll', 'scrollIntoViewIfNeeded']);
export function changesObservation(name, result) {
  if (name === 'run_playwright' && result?.actionIssued === false) return result.execution?.commands?.some(command => viewActions.has(command.method)) === true;
  return MUTATING_TOOLS.has(name) || ['hover_element', 'scroll_page'].includes(name);
}

export function createHarness(tools, {resumeVerification = false} = {}) {
  const catalog = Object.fromEntries(Object.entries(groups).map(([group, names]) => [group, names.filter(name => tools.some(tool => tool.function.name === name))]).filter(([, names]) => names.length));
  const enabled = new Set(core);
  const selector = {type: 'function', function: {name: 'select_tools', description: `Connect the tool groups needed for the user goal. Available groups: ${JSON.stringify(catalog)}. Choose a few groups, then inspect their schemas in the next request. This only selects existing authorized tools. It never installs software or grants site access.`, parameters: {type: 'object', properties: {groups: {type: 'array', minItems: 1, maxItems: 6, items: {type: 'string', enum: Object.keys(catalog)}}}, required: ['groups'], additionalProperties: false}}};
  let revision = 0, verifiedRevision = -1, needsVerification = resumeVerification, corrections = 0;
  return {
    selector,
    advertised: () => [...tools.filter(tool => enabled.has(tool.function.name)), selector],
    select(args) {
      for (const group of args.groups) for (const name of catalog[group] || []) enabled.add(name);
      return {ok: true, tools: tools.filter(tool => enabled.has(tool.function.name)).map(tool => tool.function.name)};
    },
    observe(name, result) {
      // A permitted call recalled from earlier context also selects its group.
      // Worker capability checks and runtime schema validation still apply.
      for (const names of Object.values(catalog)) if (names.includes(name)) for (const tool of names) enabled.add(tool);
      // Correct a failed generated script with already-authorized semantic
      // tools as well. This never grants permissions or replays an action.
      if (name === 'run_playwright' && (result?.error || result?.ok === false) && result?.error !== 'cancelled') {
        for (const group of ['input', 'interaction', 'navigation']) for (const tool of catalog[group] || []) enabled.add(tool);
      }
      if (result?.visualRecovery) for (const tool of catalog.images || []) enabled.add(tool);
      if (MUTATING_TOOLS.has(name) && !result?.cancelled && !(name === 'run_playwright' && result?.actionIssued === false)) {revision++; needsVerification = true;}
      if (name === 'verify_page') {
        verifiedRevision = result?.ok === true && result?.verified === true ? revision : -1;
        // A verified stage starts a new repair window. Reads, new references,
        // further writes and failed checks cannot reset a stalled stage.
        if (verifiedRevision === revision) corrections = 0;
      }
    },
    needsCheck: () => needsVerification && verifiedRevision !== revision,
    repairMessage() {
      if (++corrections > 2) return null;
      return {role: 'user', content: 'Harness result check: the browser actions have not yet passed a fresh verify_page check. Do not report completion. Inspect the current result, then call verify_page with concrete checks derived from the original user goal (all required fields and the relevant visible saved/sent/navigation outcome). A click, plan status, script return value or screenshot alone is not proof. If checks fail, correct from the current state without replaying completed writes. If fresh evidence does not establish how to proceed or required information is missing, call ask_user with a focused question and wait. Do not guess, silently stop, or claim success.', timestamp: Date.now()};
    },
  };
}
