# Browser context and task memory

nubi Beta 1.0.0 keeps Pi agent-core 0.86.1, Pi AI 0.86.1, Playwright CRX and QuickJS. Pi handles the agent/tool loop; an extension-specific context layer prepares provider input and saves checkpoints. No local router, OpenCode or Node process is required.

## Why retain Pi

Pi exposes an agent loop, sequential tools, context conversion and provider adapters suitable for an embedded browser client. Its [coding-agent compaction design](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md) demonstrates summarizing older work while preserving a recent tail and prior summaries. The coding-agent session manager depends on a Node environment, so this extension implements browser persistence around that design instead of importing the CLI.

This is a compatibility and scope decision, not a claim that Pi achieves a higher benchmark score than other agents with AI Pro models. Actual model planning, summary fidelity, visual grounding and business-app behavior need company-network evaluation.

## Context preparation

1. Load the selected provider's complete stored conversation and validate its saved summary boundary against message IDs.
2. Compute the working input budget from reported maximum input and context length, reserving at most 24,576 tokens for output. An unknown model uses a 120,000-token client fallback, never shown as a provider limit.
3. At 75% of this budget, summarize older complete turns using the same provider/model, without browser tools. Retain the latest two user turns verbatim. Manual compression may retain one when only two remain.
4. Validate JSON goal, constraints, decisions, completed, pending and references. Advance the durable boundary only after the whole selected span completes and the resulting prompt fits. Invalid output never advances the boundary. Automatic compression may defer a recoverable summary failure while the original input still fits; manual compression, hard-limit overflow, interruption and storage errors remain explicit failures. The original messages remain available.
5. Send the summary, current environment and recent turns. Summaries are fallible reference data, not new instructions or authorization. Fresh user corrections and page observations take precedence.

Large historical spans are summarized in token-bounded fragments. Summaries are limited to 12K characters; AI Pro reserves at most 2,048 output tokens for them. Pi's ChatGPT subscription adapter does not expose an output-token request field, so no unsupported field is added; summary response text is capped client-side at 15K characters before validation. Both summary and ordinary responses contribute their reported usage to the same provider ledger.

Within a browser run, the complete Pi transcript is preserved while older complete tool batches are summarized. A prefix cursor prevents summary duplication; no tool-call/result pair is split. A recent token-budgeted span, the current goal and recent user requirements remain. Actual prompt usage calibrates the estimate when available. Images remain ephemeral and the latest supported screenshot is forwarded by the browser adapter. A context-overflow rejection gets one compaction/model retry, never action replay.

There is no fixed successful tool/model-call count cap. Per-operation timeouts, cancellation, recovery limits and worker lifecycle checkpoints still apply. Context compression never authorizes replaying a browser action.

## Durable browser task

The worker records a goal, an optional plan of up to eight steps, safe action receipts and the most recent page title and URL without query/fragment. A receipt is written before dispatch and updated after the result. It distinguishes a completed tool invocation from verified DOM state; neither establishes server persistence by itself.

Raw scripts, screenshots, DOM payloads, browser handles and executable VM state are not saved in checkpoints. Summary instructions omit credentials and transient IDs; validation additionally redacts Bearer/JWT-shaped text. This is not a general-purpose secret detector. Existing user/assistant conversation storage is unchanged.

After interruption, in-flight receipts become unknown. Reopening performs no browser action. An explicit retry carries the previous goal/plan/receipts into a new request, first executes a fresh browser snapshot, then lets the model verify uncertain results and choose the next step. It does not promise exactly-once website writes: a crash between a website action and its receipt can leave an uncertain outcome that must be inspected.

Version 0.13.0 adds persistent conversation selection. New chat archives the transcript, draft, selected model/skill, summary, paused task and attachment references. Selecting a session restores that context and clears its previous page binding; it never starts a browser action. Provider histories remain separate. Deleting a session removes its context and unshared attachment blobs. Tokens stay in trusted session storage. Context updates require the active request owner and unchanged credential identity; canceled and stale owners cannot overwrite memory.

## UI

The existing context ring opens usage, automatic compression status and an icon-only manual action. Remembered facts and the task plan are collapsed details. `/compact` offers the same operation from chat. Manual compression preserves an unsent draft. CX typography, tokens and keyboard-accessible buttons remain in use.

See [0.9.0 verification](VERIFICATION-0.9.0.md) for fixture and live-service boundaries.

## Beta12: actual request budgets and verbatim request anchors

2026-09-23. Input estimates now use the exact advertised tool schemas, including progress fields and the live plan/recovery guidance. Registering a large optional tool group no longer consumes context before it is selected. Enabling a group rechecks its real input cost before inference. Question-only calls budget only their question schema. Reported prompt usage still calibrates estimates; character estimates are not a Qwen tokenizer.

A separate bounded block is reconstructed from the original stored user messages before the summary boundary. It keeps whole requests, newest first within an 8% input budget capped at 2,048 estimated tokens, then presents them chronologically. Oversized requests are omitted as whole messages with an explicit omission count; no sentence is cut mid-restriction. Attachment text and failed assistant turns are excluded. This block survives subsequent in-run compaction independently of the model summary. Latest corrections take precedence; old approvals are never renewed. This improves retention but does not guarantee preservation of every historical requirement.

### Method and library decision

- [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): keep useful state outside a fallible summary and clear redundant tool output first. Existing cached-evidence retrieval, recent reads and independent execution receipts remain in use.
- [Anthropic compaction](https://platform.claude.com/docs/en/build-with-claude/compaction): preserve recent turns and account for summary costs/failures. Provider-specific compaction blocks are not portable to Qwen/FabriX, so no Claude-only endpoint is imposed on these providers.
- [Codex compact.rs](https://github.com/openai/codex/blob/ac985376787fcf69a9dcd4ef43c4eb1752f230d0/codex-rs/core/src/compact.rs): the inspected implementation preserves a bounded set of original user messages beside the summary and reconstructs current context. Nubi applies that pattern with whole-message preservation and an omission count instead of truncating a requirement. No Codex runtime or source code is bundled.
- [Pi 0.86.1 compaction](https://github.com/earendil-works/pi/blob/v0.86.1/packages/coding-agent/src/core/compaction/compaction.ts), MIT: retained token span, valid tool-call boundaries and original transcript preservation. The installed Pi agent-core remains the execution library; its Node coding-agent/session manager is not suitable for direct MV3 import. No second agent framework was added.
- Existing LangChain text splitting and MiniSearch document/evidence retrieval keep long sources outside the active prompt until a relevant range is requested. They complement compaction rather than pretending a lossy summary can replace source retrieval.

### Regression evidence

`tests/context.test.mjs` checks an intentionally lossy summary, original restrictions after reload and another compaction, whole-message omission, attachment exclusion, dynamic tool schemas, cancellation, persistence failure, retry suppression, paired results and Qwen-shaped continuation without repeating a draft write. `tests/agent-runtime.test.mjs` asserts the budget callback sees the same schemas and guidance as the actual completion call. `tests/context-browser.mjs` exercises the installed Chrome extension at a 16K context limit; the fixture limit was not raised to hide the regression. These are synthetic provider tests, not a real Qwen summary-fidelity benchmark.

## Beta13: attachment source continuity

Repository references use one-based lines, but attachment references use zero-based character offsets. The continuity record now retains validated attachment IDs, hashes and distinct read ranges, including a research delegate source re-read by the leader. It excludes failed reads and source bodies/names, keeps the existing 12-source bound and does not grant file access. The conversation-bound document reader must still validate the attachment and hash. Tests deliberately omit references from the model summary and then retrieve the original range. See [quality review](AGENT-QUALITY-BETA13.md).
