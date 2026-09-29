# Agent dependencies

## Document reading

`@mozilla/readability` 0.6.0 (Apache-2.0, https://github.com/mozilla/readability), `turndown` 7.2.4 (MIT, https://github.com/mixmark-io/turndown) and `turndown-plugin-gfm` 1.0.2 (MIT, https://github.com/mixmark-io/turndown-plugin-gfm) extract document content and convert it to Markdown in an isolated-world static bundle. They process a filtered clone, never the live page. Full license texts and dependency versions are included under `script-licenses/documents/`. Existing LangChain MarkdownTextSplitter and MiniSearch provide bounded source ranges and lexical retrieval. Browser Use's separation of action observations from document reading informs this integration; Browser Use's Python runtime is not bundled.

PDF.js (`pdfjs-dist` 6.3.289, Apache-2.0, https://github.com/mozilla/pdf.js) extracts PDF text in a local worker. Its worker, CMaps and standard fonts are bundled; no remote parser code or document upload is required. The license is under `script-licenses/pdfjs-LICENSE`; the CMap and font license files are retained in `document-assets/`.

Mammoth 1.12.3 (BSD-2-Clause, https://github.com/mwilliamson/mammoth.js) extracts DOCX raw text using its browser modules. The generated HTML conversion path is not used. Full license texts for Mammoth and its installed dependency tree are included under `script-licenses/documents/`, with names and versions in `packages.json`. JSZip is used under its MIT option. Documents are reference text; this feature does not preserve page layout, pictures or macros.

`@langchain/textsplitters` 1.0.1 and its peer `@langchain/core` 1.2.9 (MIT, https://github.com/langchain-ai/langchainjs) provide RecursiveCharacterTextSplitter for attached-document retrieval. Only local text splitting is invoked; no remote embeddings, LangSmith client or second agent runtime is started. Dependencies are pinned by package-lock.json and full license notices are included under `script-licenses/documents/`. MiniSearch ranks the resulting source chunks.

## Site wiki Markdown retrieval

`mdast-util-from-markdown` 2.0.3, `mdast-util-gfm` 3.1.0 and `micromark-extension-gfm` 3.0.0 (MIT, https://github.com/syntax-tree/mdast-util-from-markdown, https://github.com/syntax-tree/mdast-util-gfm, https://github.com/micromark/micromark-extension-gfm) parse reviewed site wiki Markdown locally. The source positions of headings, fenced code and table rows delimit retrieval excerpts. These existing Markdown renderer dependencies are pinned directly for this use. Full installed dependency licenses are included in `script-licenses/documents/`. The service-worker bundle selects the decoder's DOM-free worker export. No remote parser, embedding service or executable Markdown is used.

`mdast-util-to-string` 4.0.0 and `unist-util-visit-parents` 6.0.2 (MIT, https://github.com/syntax-tree/mdast-util-to-string, https://github.com/syntax-tree/unist-util-visit-parents) extract Markdown text nodes and walk nested table structures for site wiki retrieval. Both were already installed through the Markdown renderer and are pinned directly for this feature. Complete installed dependency licenses are included under `script-licenses/documents/`. Original source snippets and offsets remain separate from derived index text; link destinations, definitions and raw HTML attributes are not indexed as document text.

## Code highlighting

`lowlight` 3.3.0 (MIT, https://github.com/wooorm/lowlight) and its `highlight.js` dependency (BSD-3-Clause, https://github.com/highlightjs/highlight.js) render code as React text and spans. Common language grammars are bundled locally. Full licenses are included under `script-licenses/lowlight-LICENSE` and `script-licenses/highlight.js-LICENSE`.

## Browser execution packages

`minisearch` 7.2.0 (MIT, https://github.com/lucaong/minisearch) ranks local DOM candidates and selected OpenWiki folder documents and attached reference-document chunks. It is bundled into static browser modules, without a remote index, embeddings, or runtime code downloads. The full license is included in `script-licenses/minisearch-LICENSE`. Relevance ranking is not proof of a correct action target.

`acorn` 8.18.0 (MIT, https://github.com/acornjs/acorn) parses generated JavaScript locally before browser execution. It identifies syntax errors and statically known unsupported facade calls. Dynamic code still uses the isolated VM and host checks. The full license is included in `script-licenses/acorn-LICENSE`.

`dom-accessibility-api` 0.7.1 (MIT, https://github.com/eps1lon/dom-accessibility-api) computes DOM accessible names and roles. It is bundled into static observation functions at build time, with no remote code loading. The full license is included in `script-licenses/dom-accessibility-api-LICENSE`. Its calculations are not a guarantee of equivalence with every browser or Playwright edge case; observed node references are used when a semantic locator is ambiguous.

`@playwright-repl/playwright-crx` 1.21.4 bundles Playwright 1.59.1 under Apache-2.0. The distribution includes its full `playwright/LICENSE` and `playwright/NOTICE`, alongside the unmodified browser runtime.

`quickjs-emscripten-core` and `@jitl/quickjs-singlefile-browser-release-sync` 0.32.0 are MIT-licensed. Full QuickJS and wrapper copyright and license texts are included under `script-licenses/`. The browser WASM runtime is bundled locally; no executable code is fetched remotely.

## Pi agent core and Pi AI 0.87.1

Source: https://raw.githubusercontent.com/earendil-works/pi/main/LICENSE

The extension also adapts the OpenAI Codex OAuth protocol from Pi to Web Crypto and Chrome callback interception. Pi's Node OAuth server is not included or started. Its browser-specific context manager follows the documented summary and retained-tail design of Pi coding-agent compaction (https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md); the Node coding-agent package is not bundled.

MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## TypeBox 1.3.27

Pi uses TypeBox for tool schemas. Nubi also uses its interpreter-based `typebox/schema` validation to check raw arguments without coercion and return bounded, value-free correction paths. The package is pinned directly and its full installed license is also included in `script-licenses/documents/typebox@1.3.27/`.

Source: https://raw.githubusercontent.com/sinclairzx81/typebox/master/license

TypeBox

The MIT License (MIT)

Copyright (c) 2017-2026 Haydn Paterson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## OpenAI provider logo

The unmodified `public/icons/openai.svg` is from the official OpenAI Agents JS repository: https://github.com/openai/openai-agents-js/blob/main/docs/src/assets/light-logo.svg

The OpenAI logo is a trademark of OpenAI and identifies the ChatGPT login provider. Brand guidance: https://openai.com/brand/

MIT License

Copyright (c) 2025 OpenAI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
## FabriX provider mark

The FabriX SVG mark was supplied by the user for this integration. Its path and original turquoise color are preserved in `icons/fabrix.svg`. FabriX is a Samsung SDS product mark; inclusion does not imply endorsement.

## Model connection recovery

- p-retry 8.0.1 (MIT): https://github.com/sindresorhus/p-retry
- is-network-error 1.3.2 (MIT): https://github.com/sindresorhus/is-network-error

Licenses are bundled in `script-licenses/`. Retry applies only to transient model requests, never browser actions.

`@tanstack/query-core` 5.103.2 (MIT, https://github.com/TanStack/query) manages bounded state-query retries, caching and cancellation in each extension view. It does not execute or retry Agent actions. The full license is included in `script-licenses/tanstack-query-core-LICENSE`.

## yaml

`yaml` 2.9.0 is used for SKILL.md frontmatter parsing. ISC license. Source: https://github.com/eemeli/yaml . The distribution includes `script-licenses/yaml-LICENSE`.

- `@modelcontextprotocol/sdk` 1.30.0 (MIT): HTTP/HTTPS Streamable HTTP client. Schema validation is supplied by the existing CSP-safe TypeBox interpreter.
- `idb` 8.0.3 (ISC): structured-clone directory handles and transactional VOC revisions.
- Complete installed MCP/idb dependency license texts are included under `script-licenses/documents/` in the extension ZIP.

## dnd kit

Queue drag sorting uses @dnd-kit/core 6.3.1, @dnd-kit/sortable 10.0.0, @dnd-kit/utilities 3.2.2 and their accessibility dependency (MIT). Source: https://github.com/clauderic/dnd-kit. License texts are packaged in script-licenses/dnd-kit-*-LICENSE.

## big.js 7.0.1

- Source: https://github.com/MikeMcl/big.js
- License: MIT (bundled as `script-licenses/big-js-LICENSE`).
- Use: exact decimal addition and multiplication of observed numeric form inputs in `verify_page field_sum`. No network or native runtime.

## p-limit 7.3.3 / yocto-queue 1.2.2

MIT. https://github.com/sindresorhus/p-limit and https://github.com/sindresorhus/yocto-queue . The browser analysis coordinator uses p-limit for bounded concurrent assignments and queue cancellation; yocto-queue is its FIFO dependency. Licenses ship in `script-licenses/p-limit-LICENSE` and `script-licenses/yocto-queue-LICENSE`.

## Approved browser file uploads

`buffer` 6.0.3 (MIT, https://github.com/feross/buffer) adapts original conversation-owned attachment bytes to the existing Playwright CRX `setInputFiles` buffer contract. Its `base64-js` and `ieee754` dependencies are pinned in package-lock.json. All three license files are bundled under `licenses/`. No filesystem path, native host, remote upload service, or second browser driver is introduced. Claude's distributed implementation was inspected for comparison and was not copied. rrweb (MIT) was evaluated but not included: semantic workflow recording does not need a full DOM/session replay payload.

## Approval serialization

`fast-json-stable-stringify` 2.1.0 (MIT, https://github.com/epoberezkin/fast-json-stable-stringify) provides deterministic object-key serialization before SHA-256 approval fingerprints. Arrays, document identities, file hashes and values remain significant. It is bundled locally without runtime network access. The full license is included at `script-licenses/fast-json-stable-stringify-LICENSE`.
