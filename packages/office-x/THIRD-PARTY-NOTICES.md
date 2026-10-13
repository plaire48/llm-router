# Source provenance

## GenOffice — Apache-2.0

The AgentLoop, skill composition, context compaction, argument validation,
streaming provider implementations and provider error handling are the actual
GenOffice source, not a reimplementation.

- Source: https://github.com/genspark-ai/genoffice
- Revision: `438d9c65709952490c970beaa2599ef45e74431f`
- Unmodified prompt guides: 11 Sheets guides and 3 Slides prompts, provided on demand by `load_office_guide`; native COM guidance is an Office X adaptation.
- Unmodified packages: agent-core, ai-provider, ai-search, electron-utils, pptx-engine, pptx-render, pipelines, zip-gate, docx-engine, pptx-ops, pdf2docx, font-metrics. 4,582 original files with hashes. The full original six-editor source, CLI, XLSX gateway, i18n, UI, project store, attachment parser and HTML converter are included. Generated adaptations are recorded separately in companion/adaptations.json.
- Copyright: 2026 Mainfunc, Inc.
- Original LICENSE and NOTICE retained in `vendor/genoffice/`.
- Per-file hashes: `vendor/genoffice-source.json`.
- Office X integration code lives outside `vendor/`. No `ee/` sources are included.
- Original PPTX/PDF engines parse and generate explicit local artifacts. Open documents are accessed through VSTO; original Electron editor UI is excluded.

## Existing Nubi Office and Office AI Agent

The Excel VSTO generated entry point (`ThisAddIn.Designer.vb` and `.xml`) is
copied from the user's Nubi Office checkout, originally based on
it235/office-ai-agent, revision `1fd78d345b9444720f6589f1264c80028729a9f0`.
The Apache-2.0 license is retained in `licenses/office-ai-agent-Apache-2.0.txt`.
The ribbon/lifecycle and child-process bridge are adapted for Office X;
the document adapter reuses Nubi's COM identity binding approach with a new,
bounded transaction contract. These adaptations are marked in source.
Existing Nubi branding and unrelated code are not relicensed by this notice.

The Nubi A2A module was inspected as an integration candidate; it is not bundled
or enabled in this initial Excel add-in. No Workspace source was modified.

## Native runtime dependencies

Newtonsoft.Json 13.0.3 (MIT) is used for the native JSON bridge.
Microsoft Office interop and VSTO runtime are used under their Microsoft terms.
Node.js is an external prerequisite for development and is bundled in the Windows installer. PDFium WASM is bundled for local PDF conversion/rendering; dependency notices are generated under dist/licenses.
Development-only npm dependencies are recorded in package-lock.json.

## Nubi Workspace UI and provider sources (0.2.0)

Selected current working-tree files from the user's llm_router repository are
preserved under vendor/nubi. Exact paths and hashes, and the extracted toPi wire
conversion provenance, are recorded in vendor/nubi-workspace-source.json.
These private Nubi sources and branding are not relicensed as Apache-2.0.
The CX 0.5.4 package declares UNLICENSED and remains subject to its existing terms.

Nubi's ChatGPT protocol adapter uses @earendil-works/pi-ai 0.86.1 (MIT).
The Pi agent engine and Nubi runAgent implementation are not included in the
worker; GenOffice AgentLoop remains the sole agent engine. React, react-dom,
react-markdown, remark-gfm and their dependency versions are pinned in
package-lock.json. Build output retains npm license files and a package inventory
under dist/licenses. Public redistribution of private Nubi/CX code is not granted
by these third-party notices.

Microsoft.Web.WebView2 1.0.3240.44 is governed by its Microsoft package terms;
LICENSE and NOTICE are retained in licenses/. The Evergreen Runtime is an
external prerequisite and is not bundled in this source archive.
