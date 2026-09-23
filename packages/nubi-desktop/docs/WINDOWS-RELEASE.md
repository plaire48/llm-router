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
