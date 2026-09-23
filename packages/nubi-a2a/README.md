# Nubi A2A collaboration

Nubi Desktop supplies versioned source and OpenWiki context. The browser and Office receive a task, import it into their existing chat, and return that chat's completed answer to the original desktop task. The desktop's next analysis receives those drafts as reference data.

This is a local coordinator with two outbound clients. It does not advertise three independently hosted A2A servers or remote Excel/browser execution.

## Development

Run `npm ci --prefix packages/nubi-a2a` from the repository root before installing/building the consuming applications. The SDK is bundled into their existing runtimes; end users do not install this package, Node, or a separate router. Tests: `npm test --prefix packages/nubi-a2a`.

## Adopted library and protocol

- Official [`@a2a-js/sdk`](https://github.com/a2aproject/a2a-js) **1.2.0**, Apache-2.0. Uses its actual JSON-RPC client, Agent Card resolver, DefaultRequestHandler, event pipeline, protobuf JSON codecs and task-store filtering.
- [A2A 1.0](https://a2a-protocol.org/v1.0.0/specification/) `SendMessage`, `GetTask`, `ListTasks`, `CancelTask`. No claimed 0.3, gRPC, streaming, push or general third-party-agent conformance.
- Protocol tasks carry Nubi's `nubi-collaboration-v1` application data in DataParts. A shared context ID links the original desktop task. Artifacts retain request, criteria IDs, relative source paths, hashes, bounded excerpts, Wiki freshness and context digest.
- `jose` is the SDK dependency. Original license texts are in `licenses/`; consumer builds include them.

Using the official transport avoids maintaining a look-alike protocol. Existing Pi runtimes, browser ownership checks and Office native/HITL execution remain the actors. MCP/OpenWiki read tools remain separate from cross-agent task exchange.

## Workflow

1. Desktop: open a task, expand **다른 누비와 작업**, request a browser scenario or Office review document, then generate a recipient connection address.
2. Recipient: open **설정 → 누비 작업 연결**, paste the address and connect. Pick **요청 가져오기**.
3. Review the imported context in the existing composer. Sending it starts the normal local agent, including its questions and edit approvals.
4. Reopen the connection panel and choose **답변 보내기**. Only the host-observed completed answer from the bound run can be sent. Caller-supplied answer text is ignored by host adapters.
5. Desktop displays the received draft and retains it in SQLite. The next desktop analysis includes bounded received drafts. Source/Wiki versions are checked again before accepting a result.

## State and recovery

- A request awaits recipient input (`INPUT_REQUIRED`). `COMPLETED` means the draft artifact was delivered, never that an application test passed or a document was saved. The artifact has `verification: not_run`; desktop acceptance criteria are unchanged.
- Request/message IDs, payload fingerprints, persisted receipts and `GetTask` reconcile duplicate/uncertain delivery. They never replay browser actions, shell commands or Office edits.
- SQLite task/artifact records survive desktop restart. Invitations and bearer tokens do not. Re-pairing the same task preserves a recipient run binding when its ID and context digest match. Different projects cannot inherit it.
- Chrome stores credentials and task bindings in trusted `chrome.storage.session`, so MV3 suspension and UI reload can resume lookup. Browser restart requires reconnecting. Office holds them only in the worker's memory; worker restart recovery is not claimed.
- Only one imported task is active per recipient. Disconnect or request detachment retains the conversation. Transfer cancellation prevents later delivery. It does not cancel an independently started local browser or Office run; that run's existing Stop control owns execution cancellation.
- Current inbox shows the latest 25 tasks and explicitly signals more results. Desktop overview shows 30. No automatic retention/deletion policy was introduced.

## Boundaries

Loopback IPv4 only. The desktop starts the listener on explicit request/invite. Invitations are recipient-specific, single-use and expire after ten minutes. Bearer access expires after eight hours; pairing again revokes the previous token for that recipient. The Agent Card and task methods require authentication. Recipient stores isolate both task contents and pagination counts. Host/Origin validation and request/response size limits apply. Authentication is never model context. No existing SSO/token store is shared.

Source context is bounded (four files for browser, three for Office, two Wiki excerpts); omissions are explicit. User request and acceptance criteria are never silently truncated. Oversized imported requests fail with a request to narrow scope (browser 16,000 characters, Office 8,000). Wiki text and returned drafts are untrusted reference data. DB row values are not collected. A source hash is version evidence, not proof of factual correctness or deployed behavior.

This first workflow exchanges scenario/document drafts. Executed browser evidence, screenshot/file artifact upload, Office file transfer, automatic multi-host execution, LAN/cloud discovery, task subscriptions and external generic-agent adapters are not implemented.
