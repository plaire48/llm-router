# Third-party components

Versions are pinned in the package lock. Original source notices and installed package licenses remain authoritative. No upstream Theia source is patched.

| Component | Version | License | Use |
|---|---|---|---|
| Eclipse Theia | 1.75.0 | EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0 | IDE, Monaco integration, browser and desktop host |
| Electron | 42.8.1 | MIT; bundled Chromium/Node notices also apply | Desktop window |
| React / React DOM | 19.2.8 | MIT | Shared UI |
| Pi agent-core / pi-ai | 0.86.1 | MIT | Existing Nubi agent and provider runtime |
| @vscode/ripgrep | 1.18.0 | MIT wrapper; ripgrep MIT OR Unlicense | Bounded native source search; platform package retained by npm |
| TypeScript | 5.9.3 | Apache-2.0 | In-memory JS/TS syntax diagnostics and declaration outlines |
| jsonc-parser | 3.3.1 | MIT | Strict JSON and explicit JSONC syntax checks |
| p-retry / is-network-error | 8.0.1 / 1.3.2 | MIT | Shared Nubi inference-only retry, cancellation and network failure classification |
| OpenWiki local source | repository-pinned `packages/openwiki` | MIT | Retrieval, Claims validation, repository evidence resolution and read-only pairing API |
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
