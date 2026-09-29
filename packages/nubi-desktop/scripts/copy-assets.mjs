import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
const target=process.argv[2]||'browser-app';
if(!['browser-app','electron-app'].includes(target))throw new Error('target_invalid');
await mkdir(`${target}/lib/frontend`,{recursive:true});
await cp('../../extensions/aipro-chat/public/icons',`${target}/lib/frontend/icons`,{recursive:true});
await cp('runtime/computer-pointer.ps1',`${target}/lib/backend/computer-pointer.ps1`);
// Theia bundles backend modules into lib/backend/main.js; keep the owned worker alongside it.
await cp('extension/lib/node/service-entry.mjs',`${target}/lib/backend/service-entry.mjs`);
// The OpenWiki update runner, imported by the worker from beside it when an update runs.
await cp('extension/lib/node/openwiki-update',`${target}/lib/backend/openwiki-update`,{recursive:true});

for(const worker of ['schema-worker','database-worker','code-analysis-worker']) await cp(`extension/lib/node/${worker}.mjs`,`${target}/lib/backend/${worker}.mjs`);

await cp('../nubi-a2a/licenses',`${target}/lib/a2a-licenses`,{recursive:true});

const index=`${target}/lib/frontend/index.html`;
const html=await readFile(index,'utf8');
await writeFile(index,html.includes('data-nubi-favicon')?html:html.replace('</head>','<link data-nubi-favicon rel="icon" type="image/png" href="./icons/agent-32.png"></head>'));

await cp('generated/runtime-provenance.json',`${target}/lib/runtime-provenance.json`);

await mkdir(`${target}/lib/licenses`,{recursive:true});
await cp('../openwiki/LICENSE',`${target}/lib/licenses/OpenWiki-SDS-LICENSE`);
await cp('node_modules/dompurify/LICENSE',`${target}/lib/licenses/DOMPurify-LICENSE`);

await cp('vendor/licenses',`${target}/lib/licenses`,{recursive:true});
