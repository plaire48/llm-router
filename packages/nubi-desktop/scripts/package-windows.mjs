import {spawn} from 'node:child_process';
import {readFile,copyFile,mkdir} from 'node:fs/promises';
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
// Let electron-builder create Windows icon sizes from the approved transparent master.
// Chrome's 128px toolbar asset is below electron-builder's 256px minimum.
const source='../../extensions/aipro-chat/design/brand/bird-master.png',png=await readFile(source);
if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.readUInt32BE(16)<256||png.readUInt32BE(20)<256)throw Error('windows_icon_resolution');
await mkdir('electron-app/resources',{recursive:true});await copyFile(source,'electron-app/resources/nubi.png');
await run(process.execPath,[require.resolve('electron-builder/cli.js'),'--projectDir','electron-app','--win','--x64','--publish','never']);
