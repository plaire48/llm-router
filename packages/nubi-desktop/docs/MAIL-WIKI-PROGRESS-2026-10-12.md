# Mail diagnostics, Wiki preparation and installer timing

The installed Windows app reported `mail_uidl_invalid` after reaching `pop3.samsung.net:995` with valid credentials. This code originates after TLS, USER/PASS and UIDL retrieval, in client listing validation. It does not establish that POP3 is disabled or that SSL failed. The company listing has not been captured, so its specific invalid-listing subtype remains unverified.

The client incorrectly rejected the whole mailbox when two message numbers shared a UIDL. [RFC 1939, UIDL](https://www.rfc-editor.org/rfc/rfc1939.html#page-12) allows identical copies to share an ID. Keep one stable identity for these copies and accept horizontal padding around number/ID without changing the opaque ID. Retain the 1–70 printable ASCII ID limit, safe positive numbers, response byte limits, strict command framing, TLS verification and no-DELE behavior. Do not suffix IDs with volatile message numbers. Malformed rows and conflicting numbers remain failures with distinct fixed codes. Reuse pinned node-pop3 and the existing bounded terminator handling; no new dependency.

Distinguish TLS trust, certificate hostname/validity, system CA availability, DNS, refused connection, timeout, login rejection, UIDL rejection/format and RETR rejection. Settings keep a compact error disclosure. Diagnostic copy contains only a fixed server/port/TLS/code, never account names, passwords or server replies. Clearing a submitted password resets its browser validation state so a listing failure does not paint the password as invalid.

Wiki initialization previously awaited full source enumeration before creating its job. Create and return the scanning job before that work, keeping cancellation/status available. Detect existing Wiki pages within their own directory. Completed/existing Wiki changes belong to the update flow. Persist progress on state/stage/percentage changes or every 250 ms, rather than a SQLite write per file.

The Workbench also marked a job as shown while another modal prevented its display. Mark it only when shown. Closing the model picker then opens progress; backgrounding does not reopen it. Read Wiki status immediately and every 500 ms while running; apply direct retry/cancel results only in the same project.

Keep scanning, reading, snapshot, snapshot Git, planning, generating and publishing distinguishable. Permission, space, output conflict, missing/no-readable source, Git, model and malformed-response failures retain fixed codes, stage and measured duration. Raw paths/server/model exception text never reaches this diagnostic. Unsupported binary/oversized files stay outside coverage; unexpected read failures are no longer swallowed. An unknown failure remains `wiki_failed`, without inventing a cause. The native OpenWiki repository runner and model transport are unchanged. This does not prove the user's company-model failure is resolved.

The installer no longer stays on `남은 시간 계산 중`. It shows phase and measured elapsed time; the real 7z byte callback gives extraction percent and phase-only ETA after one measured second. Other phases do not invent an overall ETA. Keep the unsafe nsDialogs timer removed from the standard page (PROJECT-NAVIGATION-2026-10-12.md).

Verification before Windows packaging:

- Local TLS POP3: 11 integration tests, including fragmented terminators, Korean MIME, duplicate UIDLs/padding, malformed listings, trusted/untrusted TLS, hostname mismatch, auth rejection, no secret persistence and no DELE.
- Listing/error contracts: 2 tests, including diagnostic privacy.
- Wiki/init/update: 29 tests, including immediate status during held listing, cancellation, retry, native runner bridge and conflict preservation.
- Chrome mail settings: 8 checks. Modal suite: 34 checks, including Wiki starting beneath model selection, scanning, staged failure and background behavior. Synthetic providers, not real accounts.
- Windows package/installer results follow below. Company POP3 and the user's failed model run remain separate verification.

Full local regression: 837 total, 640 passed, 197 existing disabled-feature skips, zero failures. Native Electron project/navigation checks passed 7 cases. The user supplied the S29/S29b work report during packaging: the four referenced implementation files (`wiki-evidence.mjs`, `wiki-update.mjs`, `wiki-update-view.mjs`, `recovery.mjs`) already match this release source byte-for-byte. Keep that prior live evaluation separate from the current local and Windows checks. Correct the historical automatic-Wiki note in LIVE-EVAL.md without changing its scores or benchmark scope.
