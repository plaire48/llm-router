# Windows installer verification

> A2A는 사용자 요청으로 보류했습니다. 기존 실험 코드는 참고용이며 현재 앱과 설치 파일에 연결 UI나 전송 실행 경로를 포함하지 않습니다.

The Windows x64 installer uses the existing Theia Electron application and electron-builder 26.15.3 (MIT). The structure follows [Theia IDE packaging](https://theia-ide.org/docs/blueprint_documentation/) and its [official configuration](https://github.com/eclipse-theia/theia-ide/blob/master/applications/electron/electron-builder.yml). Native modules are rebuilt on Windows for Electron 42.8.1 before the production bundle is created. Mac/browser results do not substitute for this check.

The installer is per-user, needs no elevated installation, and includes the existing Nubi bird icon. It contains the application, worker, runtime dependencies and a SHA-256 verified Microsoft winapp source d626d2b53b9e x64 driver. The driver is checked again before each action. The app still requires a Git installation to work on Git repositories and a configured provider account to call a model. Driver inclusion grants no app/window or input approval.

## Build and release gates

1. Install the package locks, compile shared Nubi and OpenWiki-SDS source, and run contract checks.
2. Verify an owned Windows WPF window using the real winapp driver: enumerate, inspect, literal value write/readback and PNG capture.
3. Rebuild native modules for Electron, build the production bundle, and generate the NSIS installer.
4. Install into an isolated directory. Launch the installed Electron application and verify the trust prompt, Nubi UI, compiled worker IPC, SQLite, source reads and OpenWiki-SDS retrieval.
5. Reinstall, uninstall, record the actual Windows edition and Authenticode status, and generate the installer checksum.
6. Publish only the installer whose checks passed. Keep validation reports with the artifact.

The workflow builds on GitHub Windows runners. Their actual OS is reported in `windows-installer.json`; a Windows Server runner result must not be described as a Windows 11 end-user test. Corporate SSO, live-model accuracy, company applications, DPI and multiple monitors remain separate acceptance checks. No publisher certificate is configured; an unsigned beta must not be described as signed or production verified.

## Quality improvements

- DOMPurify 3.4.15 replaces both the npm dependency and Monaco's vendored 3.2.7 copy through Theia's supported esbuild configuration. The build fails if the interception is unused. The actual Monaco sanitizer is checked in Chrome/Edge for safe markup, unsafe links and per-call attribute rules. See [upstream hardening release](https://github.com/cure53/DOMPurify/releases/tag/3.4.15).
- UUID 11.1.1 preserves CommonJS and `v4()` used by react-tooltip/trash while including the [buffer bounds fix](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq). Mocha's diff uses patched 8.0.3. APIs are tested rather than accepting an audit-only improvement.
- A newer pending/uncertain Windows action blocks continuation from an older receipt. This preserves the [separate harness state and action verification](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) principle.
- `lib/runtime-provenance.json` records OpenWiki-SDS package identity, version and the digest of the source files actually bundled. Full CLI generation is not implied by the presence of retrieval/Claims/pairing functions.

No new agent framework was added. Existing Pi, OpenWiki-SDS, SQLite and Theia remain the execution and evidence foundation.

## A2A deferral verification

The desktop omits peer controls and polling, excludes the A2A server/client/SDK from production bundles, and rejects legacy collaboration requests with `a2a_not_enabled`. Existing stored records are preserved but are not injected into model context. Shared error-name constants are inert and remain compatible with the Office error mapper. A build-time input check prevents accidentally restoring the transport. Prior experimental source is reference material only.

After deferral, the isolated release snapshot passed 111 runtime tests, 45 actual Theia UI checks, 14 shared UI checks and a macOS Electron UI/worker/SQLite/OpenWiki-SDS smoke. These are not Windows installer or real model results.

Pinned winapp promotes unique automation IDs during tree inspection but returns canonical UIA selectors for property/value queries. The adapter validates the returned selector and exact automation ID, retains the canonical identity for before/after comparisons, and reads the value by that canonical selector. Mismatched aliases remain rejected. This follows the pinned upstream `UiGetPropertyCommand`, `UiGetValueCommand` and `PromoteUniqueAutomationIds` implementations.

## Current cursor and administrator policy

The earlier virtual-only deployment hold was superseded by the user: use the black rounded arrow with a white outline as a visual overlay; keep UIA as the default; offer physical mouse control only after three qualifying UIA failures and separate per-action HITL. No badge is attached. The native visual pointer and UIA checks are required for this candidate.

Administrator PowerShell commands have a separate one-action approval and Windows RunAs request. The application and per-user installer stay unelevated. CI checks the actual elevation bridge on an already-admin runner; interactive UAC on company Windows 11 remains unverified. See ADMINISTRATOR-EXECUTION.md.

The release workflow includes current compaction, virtual cursor and elevation contracts. Installer creation, actual installed-app checks, reinstall and uninstall must all pass for the same artifact before publishing a beta. A2A remains deferred.

## Unicode shortcut verification

On the English Windows runner, WScript.Shell read the old ASCII shortcut correctly but returned an empty target for the existing Korean-named shortcut. The verification reader therefore uses Windows SDK IShellLinkW and IPersistFile to read Unicode paths, rather than treating an empty legacy COM result as proof of a broken installer. A native fixture runs before packaging and checks the target, icon and unchanged link bytes. The installed Desktop and Start menu links must both have the approved Korean name, point to the installed executable and use its icon. These are verification helpers, not an additional packaged runtime or a shortcut recreation workaround. [Microsoft API](https://learn.microsoft.com/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw).

## 1.0.0 identity update

The user-approved product name is 누비 workspace and its display version is beta 1.0.0. The release title and catalog use 누비 workspace beta 1.0.0. Shortcuts use the product name, while the uninstall entry and window title also include the display version. Package locks, installed Electron version and Windows file metadata must agree on 1.0.0. The stable app ID, executable and state paths preserve upgrade identity. No new dependency is needed.

This release's workflow upgrades the SHA-256-pinned 0.1.1 verified installer from build run 35864493370, with read-only Actions access. The matching previous release remains archived in AI Workspace. CI artifacts expire: for later releases, update this baseline to an accessible verified release or a retained successful run and checksum. Do not remove the upgrade gate.

## 1.1.1

Display version beta 1.1.1. The shared runtime, OpenWiki-SDS and the Office worker files stay at their 1.1.0 release versions; only the Desktop changes. "프로젝트 열기" runs the folder command that every platform enables, and each reason a folder cannot open has its own message. A folder without Git or outside a Git repository shows a setup card with the exact commands, run after one approval: a per-user winget install of Git (the new git.exe is found and added to the running app's PATH), or `git init` with an empty first commit whose author is "누비 workspace" only when Git has no user name. When an install fails, the model reads the output and proposes another command, again for approval; an administrator command is shown for the user to run. The folder then opens and a first task prepares its environment (dependencies, build, test) with the usual approvals. The bird stays above its sparkles.

The upgrade gate installs the verified 1.1.0 installer (run 36651590466, draft release `nubi-desktop-v1.1.0-run-36651590466` of plaire48/llm-router, SHA-256 `107933dc1fdb19e3949a0817ee89bff2d330d209e1d04551b0248c48dd1c4e86`) and then this candidate over it; keep that draft release while it is the baseline. `scripts/check-project-setup.mjs` opens a folder outside a repository in the actual Theia app and creates the repository through the card.

## 1.1.0

Display version beta 1.1.0; package locks, the installed Electron version and Windows file metadata agree on 1.1.0. The name, app ID, executable and state paths are unchanged, so 1.0.0 installations upgrade in place.

The upgrade gate now installs the verified 1.0.0 installer from build run 35870591663 (artifact `nubi-workspace-windows-x64`, retained until 2026-12-22, SHA-256 `2cf070446d301a20e57b0722a8fa15400f6e18947b1f3c63813dc379a45ea59e`), then this candidate over it. The published 1.0.0 release in AI Workspace holds the same file. For a later release, move the baseline to 1.1.0 before that artifact expires.

Since 1.0.0 the shared runtime imports OpenWiki-SDS source at run time (`agent-runtime.js` -> `openwiki-agent.js` -> `wiki-question.ts`), so the contract checks need OpenWiki's own dependencies, and the OpenWiki update runner is bundled from them. The workflow installs them with the pinned pnpm 11.25.0 and the frozen lock, without install scripts, as in development. The first 1.1.0 run failed without them: 56 test files could not resolve `minisearch`.

The Actions artifact storage of the account was full during the 1.1.0 build, so the verified installer, its checksum and the reports are published to a draft release of the build run in plaire48/llm-router (`nubi-desktop-v<version>-run-<run id>`), not to an artifact. The unverified candidate and diagnostics uploads continue when storage is full. The public release is still made in AI Workspace from those files after their checksum is compared.

A release commit snapshots every bundle input listed in `generated/source-inputs.json`, not only the Desktop, shared runtime and OpenWiki folders: the runtime also imports four files of `packages/nubi-office/worker`. The first successful 1.1.0 run (36646985152) was built from a commit that kept their 1.0.0 versions, while the live measurements used newer ones, so it was not published; commit 149eb7b corrects them. Before pushing a release commit, compare the hash of each source input with the commit.

Known defect of 1.0.0 to 1.1.0 on Windows: the "프로젝트 열기" button ran Theia's `workspace:open`, which Theia enables only on macOS and in the browser, so it always failed there with a generic message. The button now runs `workspace:openFolder`, enabled on every platform, and each reason a folder cannot be opened (missing, no permission, not a Git repository, Git missing, Git refusing an unsafe owner, Git not responding, untrusted) has its own message. `check-electron.mjs`, which the installer test also runs against the installed app, clicks the button with the native dialog replaced and requires one folder dialog and no error.
