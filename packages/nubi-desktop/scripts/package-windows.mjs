import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 build host required');
const run=(file,args,cwd=process.cwd())=>new Promise((resolve,reject)=>{const p=spawn(file,args,{cwd,stdio:'inherit',shell:false});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error('build_exit_'+c)));});
await run(process.execPath,['scripts/build-runtime.mjs']);
await run(process.execPath,[require.resolve('typescript/lib/tsc.js'),'-p','extension']);
await run(process.execPath,[require.resolve('@theia/cli/bin/theia'),'rebuild:electron','--cacheRoot','..'],path.resolve('electron-app'));
await run(process.execPath,[require.resolve('@theia/cli/bin/theia'),'build','--mode','production'],path.resolve('electron-app'));
await run(process.execPath,['scripts/copy-assets.mjs','electron-app']);
// electron-builder creates Windows icon sizes from the original Nubi mascot.
await mkdir('electron-app/resources',{recursive:true});
await writeFile('electron-app/resources/nubi.png',await readFile('../../extensions/aipro-chat/design/brand/bird-master.png'));
await run(process.execPath,[require.resolve('electron-builder/cli.js'),'--projectDir','electron-app','--win','--x64','--publish','never']);
