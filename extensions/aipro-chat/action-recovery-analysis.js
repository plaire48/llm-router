const targetFailures = new Set(['script_missing', 'script_hidden', 'script_obscured', 'script_target', 'script_control_state', 'browser_stale']);
const operations = new Set(['run_playwright', 'run_skill_script', 'click_element', 'click_at', 'fill_form', 'select_option', 'press_key']);

// Diagnose only repeated, observed targeting failures. The analyst cannot
// perform actions or reconcile a missing write receipt.
export function createActionRecoveryAnalysis() {
  let last, repeats = 0;
  const attempted = new Set();
  let proposals = new WeakMap();
  return {
    assignment({name, result, signature, evidenceId, uncertain, waiting, active, planStep}) {
      if (result?.verified === true) {last = undefined; repeats = 0;}
      const reason = result?.reason || result?.error;
      if (!operations.has(name) || !targetFailures.has(reason) || !(result?.error || result?.ok === false)) return null;
      const key = JSON.stringify([signature, reason]);
      repeats = key === last ? repeats + 1 : 1; last = key;
      if (repeats < 2 || attempted.has(key) || !evidenceId || uncertain || waiting || active) return null;
      const assignment = {role: 'recovery', effort: 'quick', evidence_ids: [evidenceId],
        task: `Diagnose the repeated ${reason} result from ${name}${planStep ? ` for the current goal step: ${planStep}` : ''}. Identify one evidence-grounded alternative and the next concrete result check.`,
        constraints: 'Read only this assigned frozen failure receipt and observation. Do not browse, act, invent targets, force click, bypass approval, or replay completed or uncertain writes. The leader must obtain fresh live targets before acting.',
        done_when: 'Return a cited diagnosis and one next observation/check, or partial with the missing evidence. The browser task remains unfinished.'};
      proposals.set(assignment, key);
      return assignment;
    },
    accepted(assignment) {
      const key = proposals.get(assignment);
      if (!key) return;
      // Queue rejection is not an executed diagnosis. Acknowledge only an
      // admitted job; reset invalidates late acknowledgements after steering.
      attempted.add(key); proposals.delete(assignment);
      while (attempted.size > 128) attempted.delete(attempted.values().next().value);
    },
    reset() {last = undefined; repeats = 0; attempted.clear(); proposals = new WeakMap();},
  };
}
