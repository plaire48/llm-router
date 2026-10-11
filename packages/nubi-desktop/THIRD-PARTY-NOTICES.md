# Third-party components

Versions are pinned in the package lock. Original source notices and installed package licenses remain authoritative. No upstream Theia source is patched.

| Component | Version | License | Use |
|---|---|---|---|
| Eclipse Theia | 1.75.0 | EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0 | IDE, Monaco integration, browser and desktop host |
| Electron | 42.11.10 | MIT; bundled Chromium/Node notices also apply | Desktop window |
| React / React DOM | 19.2.8 | MIT | Shared UI |
| React Arborist | 3.16.0 | MIT | Virtualized file explorer selection and keyboard navigation |
| xterm.js / Fit addon | 6.0.0 / 0.11.0 | MIT | Manual command output terminal and container fitting |
| Pi agent-core / pi-ai | 0.86.1 | MIT | Existing Nubi agent and provider runtime |
| @vscode/ripgrep | 1.18.0 | MIT wrapper; ripgrep MIT OR Unlicense | Bounded native source search; platform package retained by npm |
| TypeScript | 5.9.3 | Apache-2.0 | In-memory JS/TS syntax diagnostics and declaration outlines |
| jsonc-parser | 3.3.1 | MIT | Strict JSON and explicit JSONC syntax checks |
| p-retry / is-network-error | 8.0.1 / 1.3.2 | MIT | Shared Nubi inference-only retry, cancellation and network failure classification |
| OpenWiki local source | repository-pinned `packages/openwiki` | MIT | Retrieval, Claims validation, repository evidence resolution, read-only pairing and partitioned document research |
| Zod (through OpenWiki) | 4.4.3 | MIT | Existing OpenWiki Claims validator; full license in vendor/licenses/Zod-LICENSE.txt |
| MiniSearch | 7.2.0 | MIT | OpenWiki structural BM25 retrieval |
| Playwright | 1.58.2 | Apache-2.0 | Local browser verification |
| pixelmatch | 7.1.0 | ISC | Pixel difference |
| PNGJS | 7.0.0 | MIT | Screenshot artifacts |
| react-markdown / remark-gfm / lowlight | 10.1.0 / 4.0.1 / 3.3.0 | MIT | Shared message rendering |
| jsdiff (`diff`) | 9.0.0 | BSD-3-Clause | Bounded changed-line summary; no fuzzy patch application |
| SQLite (Node builtin) | Node bundled | Public domain | WAL records and local execution ownership transaction |
| @xhmikosr/decompress | 11.1.3 | MIT | Maintained archive extraction for Theia CLI through a local CommonJS adapter |
| serialize-javascript | 7.0.5 | BSD-3-Clause | Patched serialization used by Theia CLI test dependencies |
| node-sql-parser | 5.4.0 | Apache-2.0 | Bounded DDL AST extraction in a worker |
| Graphology | 0.26.0 | MIT | Directed knowledge relationships and bounded traversal |
| Knex / knex-schema-inspector | 3.3.0 / 3.1.0 | MIT | Multi-database metadata inspection; no model SQL execution |
| pg / mysql2 / tedious | 8.23.0 / 3.24.4 / 20.0.0 | MIT | PostgreSQL, MySQL/MariaDB and SQL Server drivers |
| oracledb | 7.0.1 | Apache-2.0 OR UPL-1.0 | Oracle Thin driver; Oracle Client is not bundled |
| Ajv | 8.20.0 | MIT | Knowledge and change-plan contracts |
| YAML | 2.9.0 | ISC | Shared harness support and draft YAML syntax checks |
| Noto Sans KR | bundled CX font | SIL OFL 1.1 | Korean typography fallback |

`@e2e/cx-design-system` 0.5.4 is **UNLICENSED internal project material**, not an adopted open-source library. Nubi brand images and the supplied Agent Factory deck are project assets. This development package does not grant third-party redistribution rights to those assets. Public distribution requires retaining all dependency notices and resolving the internal asset distribution terms.

The development dependency overrides are explicit in package.json. `vendor/decompress-compat` only adapts CommonJS to upstream ESM; extraction and security checks remain upstream. No Theia/node_modules source is patched. Other transitive audit findings are recorded in docs/IMPROVEMENTS.md; these replacements are not a claim that all dependencies are free of vulnerabilities.

Windows packaging additionally uses electron-builder 26.15.3 (MIT) and Microsoft winapp source d626d2b53b9e (MIT; its license is bundled with the driver). DOMPurify 3.4.15 (Apache-2.0 OR MPL-2.0) replaces Monaco's embedded sanitizer through the application build hook. The pinned UUID 11.1.1 (MIT) and Mocha jsdiff 8.0.3 (BSD-3-Clause) retain their upstream notices.

User skill package import uses yauzl 3.4.0 (MIT), pinned as a direct dependency. It reads bounded ZIP entry streams; Nubi checks paths, byte limits and CRC before storing skill resources. Upstream notice: Copyright (c) 2014 Josh Wolfe. The complete MIT notice is retained in the distributed dependency license inventory.


## Read-only document research

The existing OpenWiki-SDS researcher uses the following MIT components from `extensions/aipro-chat/package-lock.json`. The build checks installed versions against that lock and resolves both the generated test module and packaged runtime to the same extension dependencies. The packaged runtime bundles the original research source once rather than importing its prebuilt copy alongside shared agent source. `generated/runtime-provenance.json` records the versions and original OpenWiki source hash. Original license texts are retained under `vendor/licenses` and copied into the host's `lib/licenses`.

| Component | Version | Purpose |
|---|---|---|
| DeepAgents | 1.13.2 | Read-only researcher execution with restricted tools |
| LangChain | 1.5.10 | Model and tool middleware |
| @langchain/core | 1.2.9 | Existing Nubi model adapter |
| @langchain/langgraph | 1.4.17 | DeepAgents execution graph |
| @langchain/langgraph-checkpoint | 1.1.5 | Framework checkpoint types and internal execution support |
| @langchain/langgraph-sdk | 1.11.2 | LangGraph transitive framework support |
| @langchain/protocol | 0.0.19 | Shared framework protocol types |
| @langchain/textsplitters | 1.0.1 | Shared retrieval dependency |
| LangSmith | 0.9.0 | Transitive LangChain runtime dependency; no LangSmith account or hosted service is configured by this feature |
| Zod | 4.4.3 | Research plan and result contracts |

The LangSmith npm package omits a license file. Its retained MIT notice comes from upstream `langchain-ai/langsmith-sdk` commit `3930fd235a767c0b849bccbeb9fa1201c522994b`, the npm `langsmith@0.9.0` gitHead, with `js/package.json` version checked. The other notices are copied unchanged from the installed pinned packages. These frameworks do not grant children filesystem, shell, native input or approval authority; the supplied read-only tools are the available execution surface.

## OpenWiki update runner

The runner of `openwiki --update` is a separate file, `lib/backend/openwiki-update/index.mjs`, loaded only when the user runs an approved Wiki update. It bundles the original OpenWiki source once; LangChain, DeepAgents, LangSmith and Zod resolve to the pinned copies listed above. `generated/runtime-provenance.json` records its OpenWiki source hash under `openwikiUpdate`. Beside it, `openwiki-update/openwiki/` holds files that OpenWiki reads next to its modules: its bundled skills (MIT, part of OpenWiki), a package name and version, and the Noto Sans KR font style of its sign-in page (SIL OFL 1.1, license text inside the file).

Additional components from `packages/openwiki/pnpm-lock.yaml`:

| Component | Version | License | Purpose |
|---|---|---|---|
| fast-glob with @nodelib/fs.scandir, fs.stat, fs.walk, fastq, glob-parent, is-glob, is-extglob, merge2, queue-microtask, reusify, run-parallel | 3.3.3 | MIT; fastq and glob-parent ISC | Repository file listing |
| ci-info | 4.4.0 | MIT | OpenWiki's environment check; no event is sent |

Not included: Mermaid and jsdom (optional OpenWiki peers; without them OpenWiki checks diagrams by rules), the model SDKs of the OpenWiki CLI providers (replaced by modules that fail when used; Desktop passes its own model), and the PostHog client (replaced by a module that sends nothing).

## POP3 and MIME

node-pop3 0.15.3, MIT, https://github.com/node-pop3/node-pop3 — POP3/TLS commands and streams. MailParser 3.9.28, MIT, https://github.com/nodemailer/mailparser — MIME decoding and attachment bytes. Exact versions are pinned in the lockfile. The repository's fragment tail adapter wraps the pinned stream parser; installed vendor sources are unchanged. Full license texts are retained in third-party/pop3/node-pop3-LICENSE.txt and third-party/pop3/mailparser-LICENSE.txt.

Computer perception (2026-10-01): Agent S3 and UI-TARS inform grounding/reflection design; their SDKs and weights are not bundled. The optional OmniParser adapter uses its HTTP contract without redistributing parser code or weights. No Python/GPU runtime is added. Review code/dependency/weight licenses separately before installing a parser. See docs/COMPUTER-PERCEPTION-2026-10-01.md.

Arborist and xterm full MIT notices are retained in vendor/licenses/React-Arborist-LICENSE.txt, xterm-LICENSE.txt and xterm-addon-fit-LICENSE.txt. Native Chromium browsing uses the pinned Electron distribution and its bundled third-party notices.
