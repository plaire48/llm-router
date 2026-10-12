# Nubi skills, tabs and remote Git follow-up

## User decisions

- Use the shared `Manufacturing-IT/ai_workspace` main catalog through existing company SSO. Render only its skill catalog in Nubi. One download installs into the current project root.
- Nubi owns `.nubi/skill/<name>/SKILL.md` and companion resources. Other clients' roots and historical registration receipts remain on disk but are not discovered, migrated or shown. This replaces the earlier `.agents/skills` contract.
- Files, web pages and terminals share one tab strip and one icon-only plus menu. Preserve drafts, editor undo, running terminals and unsaved changes.
- Manual external directory navigation is read-only and never changes the agent project or expands model tool scope.
- Composer hover keeps the quiet reference-HTML line. Focus uses existing blue/soft-blue tokens.

## Causes and changes

The AI Workspace rail previously fetched and served the entire website in an iframe. That path exposed other clients' installers and delayed entry. The rail now opens the native skill page immediately; SSO is reused by the existing catalog API. Blob reads are pinned and verified, deduplicated within a catalog, and manifest fetches have a concurrency bound of four. Search stays enabled during download. Installed resources are read back before showing success. Local files or modified packages are never silently overwritten.

Discovery, slash commands, resource paging, import, removal, recovery and company download now share the Nubi-only scope. Company downloads also appear in My Skills. Task worktrees read project-owned skills without installing a second copy in the task directory. Prior client-specific receipts use a different namespace and do not appear as missing Nubi skills.

Identical provider and Wiki polling snapshots no longer trigger whole-screen state updates. The native web surface is not downloaded just to show skills. These changes remove identified repeat work; they are not a claim that every company-PC stall has been reproduced.

Remote clone already retained full Git history. Wiki initialization then discarded it by copying files and committing a new one-commit repository. Git projects now use a detached, no-checkout worktree at their actual HEAD, with only admitted sources populated. History, remote refs and tags remain accessible under OpenWiki's existing restrictions. The parent Git repository cannot replace the exact cloned root. Clean-source metadata can retain the real HEAD; dirty/plain-folder snapshots retain source hashes without claiming a synthetic commit belongs to the original repository. Source/HEAD changes reject publication.

The external-file viewer is a main-process, human-only IPC path. It has asynchronous bounded reads, no write operation, no model tool registration and no secrets/credential-path browsing. Monaco marks external text as read-only. Project files retain the existing editor/save/readback contracts.

The skill tabs previously reused a provider switcher with equal-width segments. Its selection background squeezed the longer AI Workspace label. Skills now use intrinsic tab widths, 44px targets, normal text spacing and quiet selected backgrounds. Both tabs use the same search alignment, medium-weight titles, one-line descriptions and consistent icons. Repeated version/install labels moved to details/tooltips; download/update and exceptional states retain accessible names. Narrow views keep icons rather than wrapping labels. The native dock also keeps tabs and its plus button on one line.

## Methodology and scope

Reused the existing GHES marketplace reader, immutable Git blob verification, skill package validation, Nubi/CX tokens, Monaco, React Arborist, browser host and Git worktree mechanism. No new dependency or copied third-party implementation. Git's official [worktree contract](https://git-scm.com/docs/git-worktree) supports detached/no-checkout analysis while retaining shared repository objects. Existing OpenWiki exclusions remain authoritative; an active `.openwikiignore` can restrict shell/history access.

## Verification

- Focused skill/import/resource/Wiki tests: 48 passed before the final extra regressions.
- Remote clone and skill scope regression: 23 passed, including nested parent repository, three-commit history, remote branch/tag, HEAD/index preservation, worktree cleanup and concurrent HEAD refusal.
- External file reader: one test passed, including read-only content, secret-path/link denial and byte limits.
- Full runtime suite: 841 tests, 644 passed, 197 existing skips, no failures. Later targeted remote-root/skill/external-file regression: 24 passed.
- Modal and integrated skill flow: 35 checks passed, including direct download/search, draft preservation and tab widths at 440/800/1280px.
- Native macOS Electron: 17 checks passed, including manual external folder, read-only file, unchanged agent project, unified plus menu, web/terminal/file tabs and one-line header.
- Native skill lifecycle: nine checks passed, including folder/ZIP/Markdown registration under `.nubi/skill`, duplicate handling, trash/restore, actual discover/use tool calls against a local fixture model, and restart persistence.
- Design identity and Electron build passed. All 105 Electron surface checks passed, including narrow layouts and 200% text. Windows package checks follow separately.
- Company SSO/catalog, live provider Wiki generation and the user's Windows PC remain separate from local fixtures and hosted Windows checks.
