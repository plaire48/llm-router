// Read-only upstream CSS reference for computed-style comparison; not a live Workspace session.
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
const source='/Users/ganadi/Documents/llm_router';
const files=[fileURLToPath(import.meta.resolve('@e2e/cx-design-system/styles.css')),fileURLToPath(import.meta.resolve('@e2e/cx-design-system/fonts.css')),...['electron-app/workbench.css','design/workspace-identity.css','electron-app/shell.css','electron-app/ios-tokens.css','design/workspace-typography.css','design/workspace-density.css','design/workspace-dialogs.css'].map(p=>`${source}/packages/nubi-desktop/${p}`)];
await build({stdin:{contents:files.map(p=>`@import ${JSON.stringify(p)};`).join('\n'),loader:'css',resolveDir:process.cwd()},outfile:'dist/ui/cx-audit/reference.css',bundle:true,loader:{'.woff2':'file'},assetNames:'fonts/[name]-[hash]'});
await writeFile('verification/cx-audit/reference-sources.json',JSON.stringify({source,files,scope:'CSS source fixture, not live Electron or real authentication'},null,2));
