# Desktop modal contract

User request: consistent typography, emphasis, layered colors, geometry and spacing across all modals. This replaces overlapping per-screen modal overrides, including the earlier utility-only normalization.

## Shared rules

- Existing Pretendard/Noto Sans KR fonts and deck/CX primitives remain the source. No new UI package or copied dialog component is introduced.
- Global/semantic values live in `workspace-identity.css`; `workspace-dialogs.css` owns modal chrome and controls. Removed competing header/footer, close button, title icon, body gap and blue-only error overrides from identity/density/iOS layers. Login provider branding stays in its existing component.
- Title: 18px/600. Body: 15px/400. Secondary: 14px/400. Field labels and primary actions: 15px/600. Secondary actions: 15px/500. Key values: 600. Sizes use rem; large-text and root enlargement remain supported.
- Spacing: icon/label and field gap 8px; related sections 16px; horizontal gutter and bottom footer 24px (gutter 16px on narrow windows).
- Controls: 40px high, 44px for coarse pointers; 18px action icons, 16px field icons, 20px confirmation symbols; 12px control radius, 20px modal radius. Close buttons are square.
- Width reflects purpose: choice 420px, confirmation/account 480px, regular form 600px, wide library 760px, constrained to viewport. Composer pickers retain compact single-row navigation.
- Surface layers: white modal, pale inset grouping, soft-blue selection. Solid deep blue is the main action. Red means deletion/error, amber a caution, green a confirmed result. Do not map errors to blue. Color never replaces text/icon semantics.
- Headers and controls stay one line; narrower layouts hide optional labels while keeping accessible names/tooltips. Decision-relevant scope and recovery information remain available. Keyboard focus, dismissal, focus return and scroll behavior remain shared CX behavior.
- Skill deletion buttons name the actual action, `삭제`, instead of a generic confirmation.

## Validation

`check-all-surfaces.mjs` renders production components in Electron using synthetic accounts/data. Every visible modal is checked for identical left/right gutters, title weight, section rhythm, corner radius and square close controls. Existing checks cover 1280/440px, 200% text, no wrapped controls, no clipped dialogs, composer layout and the mail selection flow. `check-modals.mjs` separately exercises keyboard focus, cancel/return, provider refresh and post-command follow-up admission. Native Electron checks cover the actual shell/tool tabs. These checks do not establish real company authentication/model success or Windows user-PC behavior.

## Plan failure and post-command analysis

The reported “계획 형식 수정 실행 실패” can stop the task before a project tool is dispatched. Previously, repair required the same tool protocol again; a provider unable to format it had no different recovery route. Repair now requests a complete JSON object with no tools, includes the exact schema and validation problems, and uses the same intent/capability/step validators. JSON mode is requested only for this inference; the shared provider already drops unsupported response-format options. Limits are checked again before repair. Invalid plans, unknown capabilities, fabricated completion, cancellation and authentication failures never authorize execution.

This uses the existing Ajv and shared OpenAI-compatible provider rather than adding a parser or guessing missing requirements. [OpenAI structured-output guidance](https://developers.openai.com/api/docs/guides/structured-outputs) distinguishes valid JSON from schema adherence; host validation remains mandatory. This is a compatibility correction demonstrated with controlled responses, not proof of the exact failed AI Pro response on the user's PC.

Approved command completion already starts an analysis run with host receipts. The UI now distinguishes queued analysis, active analysis, interrupted analysis and returned analysis, and keeps execution output readable during analysis. A real local shell regression covers command end → saved output read → malformed plan → JSON repair → actual source read → answer, with one process only. Execution exit zero is never equated to satisfying the user's goal.

The earlier admission race fix queues a follow-up exactly once when automatic analysis starts ahead of the renderer snapshot. Windows PowerShell uses UTF-8 console output plus a child-only UTF-8 Get-Content default; explicit encodings still win. No profile, system codepage setting or existing file is rewritten.

A paused result-analysis run now retains its process ID across resume. The host verifies task ownership and a settled process before reconnecting analysis; it does not rerun the command. Local recovery regression covers a plan that remains invalid, pause, explicit resume, source read and answer for the same process.

## Native Windows caption scrim

The native Window Controls Overlay previously kept `#F1F7FE` while a CX modal dimmed the renderer. `useNativeTitlebar` now composites the visible full-window CX backdrop colors over the actual toolbar background and symbol token. It sends only validated opaque colors to the trusted desktop host. Stacked dialogs retain their combined shade; the last close restores the current theme. Renderer navigation resets the native surface. Caption height and native minimize/maximize/close behavior remain unchanged.

This uses Electron's existing [`setTitleBarOverlay`](https://www.electronjs.org/docs/latest/api/base-window#winsettitlebaroverlayoptions-windows-linux) API without a new dependency or replacement window controls. Mutation updates are filtered and coalesced into one animation frame, and unchanged colors do not cross IPC. Unit checks cover compositing, restoration and payload bounds. The Windows installed-app smoke check asserts the real native API colors when settings opens and closes. macOS checks do not establish Windows 11 visual acceptance.

## Follow-up token audit

- The purpose-based default width now covers every shared CX dialog, including FabriX, rather than only panels bearing the Nubi-specific class.
- Primary body and footer actions share paired foreground/background tokens; destructive actions use the same semantic danger token. Provider branding remains separate. Hover retains the correct contrasting foreground.
- Field labels, selected controls, titles and key values use the existing 600 emphasis token; supporting copy/input examples retain normal weight. Top-level list margins no longer double the section gap. Placeholder contrast and title-icon alignment are normalized.
- FabriX labels now match the request headers: `x-fabrix-client` and `x-openapi-token`. The Endpoint URL placeholder is `https://nsds-api.fabrix-s.samsungsds.com/sds/trial/api-chat`; this is guidance, not an automatic endpoint substitution. Password input masking and saved connection values remain intact.
- Existing surface coverage is extended with Claude install/login/update screens at normal, narrow and 200% text sizes. Rendered fixtures and simulated connection tests are not company-service or Windows SSO verification.

## Search conditions and targeted spacing

- Preserve the accepted FabriX/Claude connection and settings geometry. Do not globally shrink modal padding.
- The search dialog initially shows three aligned fields: period, sender and attachment presence. File type/name, search location and classification stay under details. Existing secondary criteria are indicated even when collapsed. Sender suggestions appear only while typing (up to six); selected senders remain visible.
- Fix the actual CX Select contract: the local wrapper converts `options` to native option children, preserving existing children, keyboard selection, events and dropdown ownership. Previously the option array became an unused DOM attribute and the period/attachment selectors were empty.
- Filter chips use existing caption typography, label/emphasis weights, control radius and semantic colors. File kinds reuse FileKindIcon. Selected blue styling is reinforced by a check and aria-pressed; the check has reserved space to avoid movement. Labels remain one line and retain full accessible names/tooltips.
- Search apply/reset actions are in the fixed footer. Tests select dates, sender, attachment type and filename, assert the applied payload and reset it. Expanded and 200% text layouts are inspected separately.
- Skill management states its project-specific purpose once, labels registration explicitly and preserves single-line names/actions. One-page catalogs no longer show disabled pagination. Eleven-item navigation remains covered.
- Current wiki status shows a success icon, title and last update with balanced vertical inset; a one-line update date no longer requires a disclosure.
- Desktop chat/mail model pickers and visual fixtures now share the provider labels, including Claude. The reviewed fixture previously omitted Claude although production Workbench already included it.

## Copy acknowledgement

All remaining Desktop copy buttons reuse the shared CopyButton. It shows the check for two seconds only after browser/native clipboard acknowledgement; failure, changed source and unmount cannot leave a false success. Keyboard focus, button bounds and reduced-motion behavior are preserved. Terminal keyboard shortcuts are unchanged.

### Verification of this follow-up

Electron build and identity checks passed. The final surface run completed 114 screen/layout checks, including search default/expanded, 440px and 200% text; search payload/reset and 11-skill pagination assertions also passed. No target text-size or horizontal-overflow violations were recorded. The overall suite subsequently failed its existing bird hover persistence assertion (`none` instead of `nubi-bird-dance`); do not report that whole suite as passing. These are isolated Electron component checks with sample data, not a Windows installer or live mail-provider test.
