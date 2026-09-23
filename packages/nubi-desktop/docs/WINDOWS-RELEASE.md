# Windows installer verification

The Windows x64 installer uses the existing Theia Electron application and electron-builder 26.15.3 (MIT). The structure follows [Theia IDE packaging](https://theia-ide.org/docs/blueprint_documentation/) and its [official configuration](https://github.com/eclipse-theia/theia-ide/blob/master/applications/electron/electron-builder.yml). Native modules are rebuilt on Windows for Electron 42.8.1 before the production bundle is created. Mac/browser results do not substitute for this check.

The installer is per-user, needs no elevated installation, and includes the existing Nubi bird icon. It contains the application, worker, runtime dependencies and a SHA-256 verified Microsoft winapp 0.6.0 x64 driver. The driver is checked again before each action. The app still requires a Git installation to work on Git repositories and a configured provider account to call a model. Driver inclusion grants no app/window or input approval.

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
