# Human-reviewed recovery in Windows Office

An uncertain write is a pause point in the existing GenOffice run. The host reads the bound document, displays one inline question and waits for an actual UI answer. The worker's ten-minute native-call timeout is disabled for this question and ordinary clarification. While waiting, there is no next model request or follow-up write. Cancellation and host disconnect still terminate the wait.

Choices: continue from current state, reread, finish here. If a previous target was deleted, the host can fall back to reading the same bound document identity and clearly asks the user to inspect its content. Failure to read even that identity offers reread/finish only. On continue, native code revalidates the document identity and repeats the observed read. A change since the question causes another review. Prior plans and snapshots are discarded. Already queued tools from the interrupted model turn are skipped. The next model turn must inspect needed targets and build a new, normally approved plan for remaining work; it cannot apply an old plan ID. The uncertain original receipt is not converted into verified success by a human answer.

Excel typed cell tools reset their local block only after the native reviewed-resume receipt. Word and PowerPoint continue through document operations, avoiding a new capture of a possibly different selection. Declined/cancelled writes do not trigger this recovery question. Failed recovery never unlocks the native write gate.

The UI shows one inline card with direct buttons. Backup information, native codes and earlier unverified changes belong in collapsed work details. Before a write without a backup, a compact disclosure and explicit apply-without-backup button remain.

This is an in-process continuation while Office and its worker stay open. It does not promise crash/restart persistence or automatic recovery of lost COM references. No LangGraph or Temporal dependency was added; GenOffice remains the agent loop.

Method references, accessed 2026-10-14:
- LangGraph interrupt/resume and idempotent side effects: https://docs.langchain.com/oss/python/langgraph/interrupts
- Temporal human input via asynchronous signals: https://learn.temporal.io/tutorials/ai/building-durable-ai-applications/human-in-the-loop/

Verification: runtime tests hold the gate open and assert no second model/native write; then resume in Excel, Word and PowerPoint fixtures. Tests cover cancellation, finish-here and skipping queued calls. Native core tests cover decline, source drift, old plan/snapshot invalidation and fresh reviewed edits. Browser tests exercise real buttons at 320px using a mock WebView host. These fixtures are not real Office or live model verification.
