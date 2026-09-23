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
// ICO contains the existing Nubi PNG unchanged, including transparency.
const png=await readFile('../../extensions/aipro-chat/public/icons/agent-128.png');
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=128;header[7]=128;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
await mkdir('electron-app/resources',{recursive:true});await writeFile('electron-app/resources/nubi.ico',Buffer.concat([header,png]));
await run(process.execPath,[require.resolve('electron-builder/cli.js'),'--projectDir','electron-app','--win','--x64','--publish','never']);
