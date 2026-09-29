## OpenWiki

This repository has documentation located in the /openwiki directory.

Start here:

- [OpenWiki quickstart](openwiki/quickstart.md)

OpenWiki includes repository overview, architecture notes, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

When working in this repository, read the OpenWiki quickstart first, then follow its links to the relevant architecture, workflow, domain, operation, and testing notes.

<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

## Nubi browser connection

The local visualizer serves `/api/nubi/v1/*` with process-memory pairing/session credentials. `--project-root` is explicit opt-in source access; absence MUST remain wiki-only. Never infer a source root from a request or the wiki parent. APIs are read-only, apply loopback Host/Origin checks, and return bounded relative-path/line/hash provenance. Graph `generatedAt` is not source freshness. Static exports MUST NOT contain pairing codes or tokens.

The paired Nubi API advertises `features: ["wiki_query", "wiki_snapshot"]` for server-side evidence retrieval. `POST /api/nubi/v1/wiki/query` searches fresh allowed Wiki text with MiniSearch structural BM25 and returns bounded excerpts with provenance and scan coverage, never an LLM-generated answer. It grants no source access beyond --project-root and no writes. Legacy wiki/search and source reads remain compatible.

The portable `agent/wiki-question.ts` core accepts a host-injected model and immutable Wiki snapshots. Nubi bundles it with the browser export of DeepAgents, separates internal/external Wiki contexts, and reuses its current provider transport. Structural context is supplied by the host parser from the same snapshot, validated and bounded separately from body coverage; it does not authorize general out-of-assignment reads. It MUST NOT load CLI credentials, shell, or filesystem backends. The authenticated `wiki/snapshot` API supplies scoped current text only, with explicit collection limits; it never runs a model.

The question core optionally accepts host-owned read-only semantic checkpoints. Restore only after matching the full authorized snapshot, original question and model fingerprint. Rehydrate citation text from current documents; never persist source bodies, provider credentials or an executable graph. Failed checkpoint writes abort sibling research; cancellation never becomes a completed report. Browser ownership, retention and explicit restart remain host responsibilities.
