# OpenWiki initialization and update recovery

The Desktop bridge was dropping native OpenWiki prerequisites and durable state. The repository runner itself is unchanged.

## Reproduced causes and changes

- Initial generation received a temporary text folder without a Git repository/HEAD. OpenWiki's `createRepositorySourceSnapshot` reads Git before planning, so it could fail before calling the selected model. Create Git metadata only inside the private analysis copy; never initialize or commit the user's source folder. Git must still be installed on the host.
- Publishing copied Markdown only. This lost `.last-update.json`, `.page-manifest.json` and `.claims` evidence, making future updates unavailable and citations unverifiable. Publish these together after source hash validation. Remove temporary commit IDs and keep a Desktop file-hash checkpoint for folders without a repository.
- Updating a Git project used the Wiki at HEAD, omitting newly generated or human-edited uncommitted pages. Overlay the current Wiki on the private worktree before calling the same native `--update` runner. Preserve committed-source scope and disclose uncommitted source exclusions. Ordinary folders use their saved files in a private Git snapshot.
- Old Markdown-only Wikis can now propose an update to rebuild their missing generation record. Results remain a proposal until applied. Capture original Wiki hashes before model execution so concurrent human edits fail with a conflict instead of being overwritten.
- The generic invalid-response retry multiplied the Wiki runner's own format-repair loop. The Wiki bridge now owns that repair budget; transport network recovery is retained. Pin provider/model/connection identity across the run. Project switch and disposal cancel the owned work.
- Keep generation stage/count/elapsed/estimated stage time in the progress UI. Show specific model, source-change, interrupted-run or missing-Git recovery text and a direct retry action. Hide provenance JSON files from the visible changed-page list while preserving their approval/apply lifecycle.

## Method and adoption

Reuse the pinned OpenWiki-SDS `runNativeRepositoryGeneration`, its model adapter, bundled skills, manifests and Claims. No alternate Wiki generator, parser or dependency is introduced. Inspect the actual pinned `packages/openwiki/src/agent/repository-runner.ts`, repository source snapshot, generation record and page-manifest implementations. Keep Desktop's original source boundary and apply approval; do not copy OpenWiki's outside-Wiki instruction/workflow changes into the source tree automatically.

## Evidence

- Full Desktop suite after bridge changes: 829 cases, 632 pass, 197 intentional environment/disabled-feature skips, zero failures. Localhost-fixture tests ran with permission for local test servers.
- Final focused native bridge suite: 26/26 pass. Tests cover private Git setup, plain-folder updates, native metadata/Claims retention, current uncommitted Wiki inclusion, approval before apply, human-edit conflict, and bounded format recovery.
- A real bundled OpenWiki repository initialization reached its first planner model call on an ordinary folder. The fixture provider then deliberately returns a 401. This proves native runner integration and clean failure, not model answer quality or successful corporate AI Pro generation.
- Windows runs the same bridge tests after building the packaged runtime, in addition to installed EXE checks. Final native installation evidence is recorded separately in the installer report.

No actual company AI Pro or company network is available from this Mac. The user's original model response has not been captured; only fixed error/stage diagnostics are retained. Real company login and complete generation on that provider require the updated Windows app in the user's environment.

Final Windows run 38190791331 passed all 26 Wiki bridge tests and both installed-EXE smoke runs. Installer source: `a540385b23d9b7f76191a304b062befe76984b44`. The current native progress view also treats pageIndex as the page being started, so the last page does not display 100% before it finishes.
