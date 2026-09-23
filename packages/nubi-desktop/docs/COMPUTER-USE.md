# Computer use and readable desktop UI

Status: implemented experimental Windows adapter and approval UI. No Windows native execution, installed winapp binary or real model accuracy has been verified on this macOS host. This is not a bundled Windows automation release.

## Interaction

Use the existing task view. Open `컴퓨터로 확인`, choose `열린 앱 찾기`, select a visible window, then `이 창 연결`. The disclosure explicitly explains that window contents and images reach the selected model and capture may foreground the app. The grant belongs to this task and host session. Project change/restart removes it.

The existing Pi runtime can call `observe_computer` and `propose_computer_action`. It receives actual PNG content through the shared image pipeline; visual interpretation requires a vision-capable selected model. One proposed click, UIA invoke, hover or literal text replacement appears as a review card. The model cannot approve it. The user approves one exact operation, followed by a screenshot and, for input, exact value readback. The next agent run receives the host receipt. It does not automatically chain desktop actions after approval.

`대상 위치 보기` shows the observed element crop. A small cursor marks its center. Click has one expanding ring, hover one brief emphasis, input an I-beam. These are **target annotations, not a recording of the OS pointer or proof of execution**. An explicit `표시 예시` is available without Windows and never calls an input tool. After images have no cursor overlay, avoiding an old target marker on a changed screen. Animation ends without looping, can be disabled, and respects reduced motion. SVG/CSS requires no extra runtime library and does not intercept pointer events.

The desktop reading scale retains the supplied deck font family, adds Malgun Gothic as a Windows fallback, and gives task text a stable 15px / 1.75 / 400 scale instead of viewport-dependent label typography. The top `가` button changes it to 17px and persists that preference locally. It does not alter editor code fonts or Office/Chrome styles. Long answers are limited to 78ch. Code remains monospace; supporting labels retain their distinct scale.

## Applied BP and OSS

| Source | Applied | Boundary |
| --- | --- | --- |
| [Microsoft winapp CLI](https://github.com/microsoft/winappCli/blob/f047f86761d880bf850148744a1ddacecf00bc65/docs/ui-automation.md) (MIT) | Actual `execFile` adapter for JSON UIA inspection, element capture, invoke/click/hover/set-value and readback. Its workflow ID coordinates cooperating native clients. | External preview dependency, not installed or redistributed here. Typed DPI/element envelopes require the reviewed API shape (docs say v0.6.3+); installed binary compatibility still requires Windows testing. |
| [Playwright actionability](https://playwright.dev/docs/actionability) and [Trace Viewer](https://playwright.dev/docs/trace-viewer) (Apache-2.0) | Adopted observe → validate → one action → inspect outcome, before/after snapshots, visible target marks. Existing Playwright executes browser UX checks. | Windows UIA checks are not equivalent to Playwright DOM stability, hit testing or auto-wait guarantees. No copying of the Trace Viewer UI. |
| Existing Nubi Pi core and image transport | Reused agent loop, model adapters, isolated analysis and image blocks; no new model runtime. | Source code and screenshots remain evidence, not instructions. Subagents cannot access these desktop tools. |
| Existing pngjs and pixelmatch (MIT) | Bounded PNG decoding and real pixel difference counts after operation. | A changed pixel or successful command does not prove the requested business outcome. |
| [Anthropic computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) | Host executes tools, obtains new observations and retains human control. | Anthropic's reference environment is not a drop-in native Windows driver. |
| [OmniParser](https://github.com/microsoft/OmniParser), FlaUI, Windows-MCP | Evaluated alongside earlier Windows research. | Not installed. Extra detector/caption model deployment and weight licensing need review; no evidence yet that they outperform existing UIA and model vision for our target applications. FlaUI remains a packaged native-host candidate. |

## Host configuration and execution limits

On a test Windows 11 host, an administrator of the Nubi application can configure an independently obtained and verified winapp executable through `NUBI_WINAPP_PATH` (absolute path) and `NUBI_WINAPP_SHA256` (64 hexadecimal characters). Configuration is outside project/model control. No PATH discovery, automatic download, PowerShell interpolation or shell execution is used. The wrapper rechecks the executable hash and calls argv directly from the temporary directory. Closing the host aborts its child calls; uncertain outcomes remain uncertain.

The app still needs foreground, unlocked desktop access for mouse injection. Do not infer support for elevation, UAC, locked sessions, RDP delivery, all applications or company security policies. A dedicated Windows session is the appropriate next validation environment. Existing Chrome and Office ports remain the preferred tools for those applications.

Supported now: observed UIA selectors, invoke with explicit action (no ancestor fallback), single click, hover with an 800ms dwell, literal `set-value`, screenshot and value readback. No raw coordinates, arbitrary keystrokes, double/right click, drag, system shortcuts, OCR-only targeting, MSIX activation or automated installation. Local Win32 EXE launch is described below. Text requires explicit non-password metadata and an editable control type; input beginning with `-` is currently rejected to avoid positional-option ambiguity. Unknown fields fail closed.

Each observation/approval expires after two minutes. Window HWND/PID/name/title/DPI, selected element geometry and flags, and input value hash are compared again before execution. Any drift requires a fresh proposal. PID/HWND reuse and changes between the last validation and the native action remain platform-level limits; this wrapper is not an isolation sandbox. Full-window observations use an explicit HWND with `--capture-screen`, including visible overlays inside that window region. Click, invoke and hover readback use this full region so an in-window tooltip is not lost by cropping the original control; different capture scopes are not pixel-compared. These images never authorize coordinates. Cursor overlay is only shown for an element crop matching its physical dimensions, so DPI or multi-monitor positions are not guessed.

Operations reserve one local desktop lane, persist `starting` before dispatch and never replay a pending or uncertain action. Lost responses, timeouts, cancelled child calls, failed window inspection or failed post-capture yield `attention`. The user checks the real app before acknowledging it; acknowledgement is not a success verdict. Restart removes the window grant and quarantines in-flight records. Application images are stored separately from lightweight action metadata in local SQLite and are read into the UI only on request. Images are not exported through A2A or written to Wiki. Explicit Wiki recording includes only bounded outcome metadata, as described below.

## Verification boundary

Contract tests execute the adapter with an injected JSON/PNG runner, covering duplicate approval, cancelled and expired actions, changed text/position/identity, password metadata, unknown execution, failed capture, restart quarantine, PNG bounds and actual Pi image transport. They do **not** run Windows UIA or a live model.

Actual Chrome tests cover Nubi login/workflow regression, cursor actions, reduced motion, the reading toggle and reload persistence, narrow layouts and the compiled Theia stylesheet. Browser and Electron builds are compilation/bundling checks, not Windows application execution.

Windows acceptance remains: Korean app names and inputs; 100/125/150/200% DPI; multiple monitors including negative origins; real hover tooltips; wrong foreground/overlays; direct user edits; disconnect during click/value write; locked session and process restart. Record native screenshots and independent result readback before enabling this preview in distribution.


## Local app launch and exact-value verification (2026-09-23)

The task's `컴퓨터로 확인 → 프로그램 실행 → 앱 파일 선택` uses Theia's existing FileDialogService. A path input is also available. Only a local drive absolute `.exe` is registered, scoped to the task and current host session. Registration computes the actual executable's SHA-256; it is not execution approval. No shell, URI, Start Menu display-name guessing, UNC path or model-supplied arguments are used. Restart/project change clears registrations.

`list_computer_apps` lets the existing Pi runtime discover these registrations. `propose_computer_launch` requires that app ID to have been listed in this run. The user can also select `실행 준비` directly. The exact path is shown on the approval card. One approval rechecks the registration/hash and journals `starting` before spawning. The bundled Node child_process implementation starts the executable with `shell:false`, an empty argv and a limited Windows environment. Project cwd, PATH, NODE_OPTIONS and provider credentials are not inherited. The executable directory is its working directory. Hash checking is not code signing or a sandbox; file replacement between verification and OS launch remains a platform limitation.

A same-process-name visible window blocks a new launch and asks the user to inspect existing windows; it is not proof that the executable is identical. After spawn, the host records the returned PID and keeps the actual child lifetime. It makes at most sixteen readiness polls with 500 ms gaps (plus bounded native-query time), matching the live child PID and re-reading UIA window status. `process_started` and `window_observed` are separate outcomes. No window means `attention`, never automatic relaunch. `열린 창 다시 확인` is read-only. Apps that hand off to another process, including some modern packaged apps, need explicit selection through `열린 앱 찾기`; no guessed PID association is made.

The user explicitly connects the observed window before model access. The launch card's connection includes its expected window identity, so a reused HWND cannot silently change the target. Closing Nubi never terminates a user's launched application. Unknown starts stay journaled across restart, while live child identity and app grants are not restored. A2A does not grant registration or execution permission.

`observe_computer` accepts `includeImage:false` for UIA-only model input. `verify_computer_value` requires a current-run observation, stable window/element identity and explicit non-password metadata; it independently reads and compares a literal expected value. Receipts are `value_matched` or `value_mismatch` with scope `exact_control_value`. They are not evidence of disk save, server acceptance or complete business success. The next analysis receives these host receipts. Approval does not automatically run another model turn or approve later input.

Explicit `Wiki에 기록` exports action IDs, action/state/outcome and control-check result/time under the original requirement/task. It excludes executable paths, titles, selectors, input/expected/actual values and screenshots from this new section. Existing source, request and human-note preservation contracts remain unchanged. A changed receipt invalidates the previous evidence digest and creates a new revision on the next explicit record action.

### Reuse decisions

- Microsoft winapp remains the UIA driver; its pinned implementation and MIT license were already reviewed. [Current official UIA documentation](https://github.com/microsoft/winappCli/blob/main/docs/ui-automation.md) confirms the structured UIA versus foreground-input distinction. This is an external test dependency, not a bundled binary.
- [Node child_process](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options) provides direct executable invocation and the child process lifecycle, without introducing another native framework. Node is already bundled for the product. Theia's installed file-dialog API is reused for app selection.
- FlaUI remains a possible packaged native-host alternative. Adding it solely for process launch would duplicate a capability already available in Node; UFO/Windows-MCP would add another runtime without resolving our current missing launch contract. No new package was added on speculative performance grounds.
- Existing Pi, AJV, SQLite, pngjs/pixelmatch and Wiki revision writing remain the execution, validation, journal, image comparison and knowledge mechanisms. Native and visual success claims stay separate.

### Windows acceptance still required

Real Windows 11 execution is unmeasured on this macOS host. Verify Korean/space-containing EXE paths, signed company apps, DLL lookup under the restricted environment, apps with child-process handoff, slow window creation, 100/125/150/200% DPI, manual edits, denial/elevation, lock/unlock, concurrent mouse use, and interruption during launch/input. Start with a non-sensitive test app. Contract tests use injected process/UIA responses; browser checks use labeled synthetic UI states. Neither proves Windows native compatibility or model accuracy.


## Windows 작업 분석 연결

동결된 UIA/캡처의 하위 분석, 근거 ID 기반 문맥 관리, 진전 없는 오류의 HITL과 `결과 분석하고 이어가기`는 [WINDOWS-HARNESS.md](WINDOWS-HARNESS.md)를 따른다. 동작 승인은 다음 동작 승인으로 이어지지 않는다.
