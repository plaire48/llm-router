import {build} from 'esbuild';
import {mkdir,copyFile,cp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {rendererBundleOptions} from './renderer-bundle.mjs';

// Both standalone Wiki tests and the packaged host resolve the same locked
// framework copies. NODE_PATH alone would prefer an optional OpenWiki install.
const sharedRoot=path.resolve('../../extensions/aipro-chat');
const sharedLock=JSON.parse(await readFile(path.join(sharedRoot,'package-lock.json'),'utf8'));
const frameworkPattern=/^(?:deepagents|langchain|langsmith|zod|@langchain\/[^/]+)(?:\/|$)/;
const researchDependencies=[];
for(const [location,locked] of Object.entries(sharedLock.packages)){
  const name=location.replace(/^node_modules\//,'');
  if(location!==`node_modules/${name}`||!frameworkPattern.test(name)||name.replace(/^@[^/]+\//,'').includes('/'))continue;
  const installed=JSON.parse(await readFile(path.join(sharedRoot,location,'package.json'),'utf8'));
  if(installed.version!==locked.version)throw Error(`research_dependency_lock_mismatch:${name}`);
  researchDependencies.push({name,version:installed.version,license:installed.license});
}
// The OpenWiki update runner reaches the OpenWiki CLI module, which imports the model SDKs of its
// own providers. Desktop passes its own model to the runner, so these are never called. They are
// replaced by modules that fail when used, instead of adding the SDKs to the build.
// The CLI's usage events go to PostHog. Desktop sends none, so its client there sends nothing.
// Mermaid and jsdom are optional for OpenWiki: without them it checks diagrams by rules. They are
// left out, as in an install without them. jsdom would also set a global window in the host process.
const UNBUNDLED={'@langchain/anthropic':['ChatAnthropic'],'@langchain/aws':['ChatBedrockConverse'],'@langchain/google/node':['ChatGoogle'],'@langchain/langgraph-checkpoint-sqlite':['SqliteSaver'],'@langchain/openai':['ChatOpenAI'],'@langchain/openrouter':['ChatOpenRouter'],'@langchain/tavily':['TavilySearch'],'@anthropic-ai/vertex-sdk':['AnthropicVertex'],'google-auth-library':['GoogleAuth']};
const unbundledProviders={name:'nubi-unbundled-providers',setup(builder){
  builder.onResolve({filter:/^(?:@langchain\/|@anthropic-ai\/vertex-sdk$|google-auth-library$)/},args=>Object.hasOwn(UNBUNDLED,args.path)?{path:args.path,namespace:'nubi-unbundled'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'nubi-unbundled'},args=>({loader:'js',contents:`const unbundled=()=>{throw new Error('openwiki_provider_unbundled');};\n`+UNBUNDLED[args.path].map(name=>`export class ${name}{constructor(){unbundled();}static fromConnString(){unbundled();}}`).join('\n')}));
  builder.onResolve({filter:/^posthog-node$/},()=>({path:'posthog-node',namespace:'nubi-no-telemetry'}));
  builder.onLoad({filter:/.*/,namespace:'nubi-no-telemetry'},()=>({loader:'js',contents:"export class PostHog{captureImmediate(){return Promise.reject(new Error('openwiki_telemetry_off'));}shutdown(){return Promise.resolve();}}\n"}));
  builder.onResolve({filter:/^(?:mermaid|jsdom)$/},args=>({path:args.path,namespace:'nubi-optional-absent'}));
  builder.onLoad({filter:/.*/,namespace:'nubi-optional-absent'},args=>({loader:'js',contents:`const error=new Error(${JSON.stringify(`Cannot find module '${args.path}'`)});error.code='ERR_MODULE_NOT_FOUND';throw error;\n`}));
}};
// OpenWiki reads some files beside its modules (bundled skills, a page style, its package version).
// In the update bundle each module's own URL points into a copy of the package layout next to it.
const OPENWIKI_ROOT=path.resolve('../openwiki');
const WIKI_URL_READERS=['src/agent/skills.ts','src/auth/aipro-callback-page.ts','src/version.ts','src/telemetry/gates.ts','src/telemetry/senders.ts'];
const WIKI_FILES=['skills','src/auth/aipro-callback-fonts.css'];
const wikiLayout={name:'nubi-openwiki-layout',setup(builder){
  builder.onLoad({filter:/\.ts$/},async args=>{
    const relative=path.relative(OPENWIKI_ROOT,args.path).replaceAll('\\','/');
    if(relative.startsWith('..'))return;
    const source=await readFile(args.path,'utf8');
    if(!source.includes('import.meta.url'))return;
    if(!WIKI_URL_READERS.includes(relative))throw Error('openwiki_update_file_reader_unknown:'+relative);
    return {loader:'ts',contents:source.replaceAll('import.meta.url',`new URL(${JSON.stringify('./openwiki/'+relative)}, import.meta.url).href`)};
  });
}};
const pinnedFramework={name:'nubi-pinned-research-framework',setup(builder){
  builder.onResolve({filter:frameworkPattern},async args=>{
    if(args.pluginData?.nubiPinnedFramework)return;
    const resolved=await builder.resolve(args.path,{resolveDir:sharedRoot,kind:args.kind,pluginData:{nubiPinnedFramework:true}});
    if(!resolved.errors.length&&!path.resolve(resolved.path).startsWith(path.join(sharedRoot,'node_modules')+path.sep))throw Error('research_dependency_scope');
    return resolved;
  });
}};
const assertFrameworkSources=metafile=>{
  for(const input of Object.keys(metafile.inputs)){
    const normalized=input.replaceAll('\\','/'),marker=normalized.lastIndexOf('/node_modules/');
    if(marker<0)continue;
    const bare=normalized.slice(marker+'/node_modules/'.length);
    if(frameworkPattern.test(bare)&&!path.resolve(input).startsWith(path.join(sharedRoot,'node_modules')+path.sep))throw Error('research_dependency_duplicate');
  }
};
const wikiBuild=await build({metafile:true,plugins:[pinnedFramework],entryPoints:['runtime/openwiki-source.ts'],outfile:'generated/openwiki.mjs',bundle:true,platform:'node',nodePaths:[path.resolve('node_modules')],format:'esm',target:'node24',external:['minisearch','yaml'],banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},legalComments:'eof'});
assertFrameworkSources(wikiBuild.metafile);
const wikiPackage=JSON.parse(await readFile('../openwiki/package.json','utf8'));
if(wikiPackage.name!=='openwiki-sds')throw Error('openwiki_sds_source_required');
const wikiSources=Object.keys(wikiBuild.metafile.inputs).filter(p=>!p.includes('node_modules')&&p.replaceAll('\\','/').startsWith('../openwiki/')).sort();
if(!wikiSources.length)throw Error('openwiki_sds_source_missing');
const wikiHash=createHash('sha256');for(const file of wikiSources){wikiHash.update(file.replaceAll('\\','/'));wikiHash.update(await readFile(file));}
// The update runner is its own folder, loaded when the user runs an update, so the host does not load it at start.
const updateExternal=['jsonc-parser','@vscode/ripgrep','knex','knex-schema-inspector','@earendil-works/pi-agent-core','@earendil-works/pi-ai','playwright','pixelmatch','pngjs','minisearch'];
await rm('generated/openwiki-update',{recursive:true,force:true});
const updateBuild=await build({metafile:true,plugins:[unbundledProviders,wikiLayout,pinnedFramework],entryPoints:['runtime/openwiki-update-source.ts'],outfile:'generated/openwiki-update/index.mjs',bundle:true,platform:'node',nodePaths:[path.resolve('node_modules')],format:'esm',target:'node24',external:updateExternal,banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},legalComments:'eof'});
assertFrameworkSources(updateBuild.metafile);
if(Object.keys(updateBuild.metafile.inputs).some(file=>/node_modules\/(?:\.pnpm\/)?(?:posthog-node|mermaid|jsdom)@/.test(file.replaceAll('\\','/'))))throw Error('openwiki_update_excluded_bundled');
for(const file of WIKI_FILES)await cp(path.join(OPENWIKI_ROOT,file),path.join('generated/openwiki-update/openwiki',file),{recursive:true});
await writeFile('generated/openwiki-update/openwiki/package.json',JSON.stringify({name:wikiPackage.name,version:wikiPackage.version,private:true},null,2)+'\n');
const updateSources=Object.keys(updateBuild.metafile.inputs).filter(p=>!p.includes('node_modules')&&p.replaceAll('\\','/').startsWith('../openwiki/')).sort();
const updateHash=createHash('sha256');for(const file of updateSources){updateHash.update(file.replaceAll('\\','/'));updateHash.update(await readFile(file));}
await writeFile('generated/runtime-provenance.json',JSON.stringify({openwiki:{name:wikiPackage.name,version:wikiPackage.version,sourceSha256:wikiHash.digest('hex'),sourceFiles:wikiSources.length,scope:'Bundled retrieval, Claims, read-only document research, repository evidence and pairing. Not the full CLI.'},openwikiUpdate:{sourceSha256:updateHash.digest('hex'),sourceFiles:updateSources.length,scope:'The repository update runner (openwiki --update), run with the Desktop model on the user\'s approval. A separate file loaded only for an update.'},documentResearch:{dependencyLock:'extensions/aipro-chat/package-lock.json',dependencies:researchDependencies}},null,2)+'\n');
await mkdir('extension/lib/node',{recursive:true});
await copyFile('extension/src/node/git-askpass.cjs','extension/lib/node/git-askpass.cjs');
await copyFile('runtime/computer-pointer.ps1','extension/lib/node/computer-pointer.ps1');
await copyFile('runtime/office-document.ps1','extension/lib/node/office-document.ps1');
await rm('extension/lib/node/openwiki-update',{recursive:true,force:true});
await cp('generated/openwiki-update','extension/lib/node/openwiki-update',{recursive:true});
for (const worker of ['schema-worker','database-worker','code-analysis-worker','mail-worker','mail-attachment-worker']) await build({entryPoints:[`runtime/${worker}.mjs`],outfile:`extension/lib/node/${worker}.mjs`,bundle:true,platform:'node',format:'esm',target:'node24',external:['knex','knex-schema-inspector','typescript','jsonc-parser','./document-extract.mjs'],banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
const sourceWiki={name:'nubi-source-wiki',setup(builder){builder.onResolve({filter:/openwiki\.mjs$/},args=>path.resolve(args.resolveDir,args.path)===path.resolve('generated/openwiki.mjs')?{path:path.resolve('runtime/openwiki-source.ts')}:undefined);}};
// The host imports the update runner from the folder next to it.
const deferredDocuments={name:'nubi-deferred-documents',setup(builder){builder.onResolve({filter:/document-extract\.mjs$/},args=>path.resolve(args.resolveDir,args.path)===path.resolve('runtime/document-extract.mjs')?{path:'./document-extract.mjs',external:true}:undefined);}};
const deferredUpdate={name:'nubi-deferred-wiki-update',setup(builder){builder.onResolve({filter:/openwiki-update\/index\.mjs$/},args=>path.resolve(args.resolveDir,args.path)===path.resolve('generated/openwiki-update/index.mjs')?{path:'./openwiki-update/index.mjs',external:true}:undefined);}};
const runtimeBuild=await build({metafile:true,plugins:[pinnedFramework,sourceWiki,deferredUpdate,deferredDocuments],entryPoints:['runtime/service-entry.mjs'],outfile:'extension/lib/node/service-entry.mjs',bundle:true,platform:'node',nodePaths:[path.resolve('node_modules')],format:'esm',target:'node24',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},external:['jsonc-parser','@vscode/ripgrep','knex','knex-schema-inspector','@earendil-works/pi-agent-core','@earendil-works/pi-ai','playwright','pixelmatch','pngjs','minisearch'],legalComments:'eof'});
assertFrameworkSources(runtimeBuild.metafile);
if(Object.keys(runtimeBuild.metafile.inputs).some(file=>path.resolve(file)===path.resolve('generated/openwiki.mjs')))throw Error('research_prebundle_duplicate');
if(!Object.keys(runtimeBuild.metafile.inputs).some(file=>file.replaceAll('\\','/').endsWith('/openwiki/src/agent/wiki-question.ts')))throw Error('research_core_missing');
if(Object.keys(runtimeBuild.metafile.inputs).some(file=>file.replaceAll('\\','/').endsWith('/openwiki/src/agent/repository-runner.ts')))throw Error('wiki_update_must_remain_deferred');
// The Electron renderer is analysed here without being written (scripts/build-electron.mjs writes it), so one compile
// records every bundle input for the release snapshot and keeps A2A authentication out of the window. The Theia
// extension bundle and its style outputs are gone: the renderer imports the workbench styles itself (2026-10-07).
const uiBuild=await build({...rendererBundleOptions(),outdir:'generated/renderer-analysis',write:false});


if(Object.keys(uiBuild.metafile.inputs).some(file=>/@a2a-js\/sdk|nubi-a2a\/(?:client|server)\.mjs/.test(file.replaceAll('\\','/'))))throw Error('a2a_auth_must_remain_in_host');
// Release snapshots copy the actual shared source dependency closure rather
// than silently taking unrelated in-progress Office/browser changes. Modules the
// build replaces (nubi-*: namespaces) are not files.
await writeFile('generated/source-inputs.json',JSON.stringify([...new Set([wikiBuild,updateBuild,runtimeBuild,uiBuild].flatMap(bundle=>Object.keys(bundle.metafile.inputs)).filter(file=>!file.includes('node_modules')&&!/^nubi-[a-z-]+:/.test(file)))].sort(),null,2)+'\n');

await build({entryPoints:['runtime/document-extract.mjs'],outfile:'extension/lib/node/document-extract.mjs',bundle:true,platform:'node',format:'esm',target:'node24',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
await copyFile('../../extensions/aipro-chat/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs','extension/lib/node/pdf.worker.mjs');

await copyFile('../../extensions/aipro-chat/public/icons/agent-128.png','extension/lib/node/auth-bird.png');
await copyFile('../openwiki/src/auth/aipro-callback-fonts.css','extension/lib/node/auth-fonts.css');
