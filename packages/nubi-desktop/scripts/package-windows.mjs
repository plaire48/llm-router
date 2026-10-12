import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
const require=createRequire(import.meta.url);
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 build host required');
if(DESKTOP_FEATURES.computerUse)throw Error('windows_driver_packaging_requires_review');
const run=(file,args,cwd=process.cwd())=>new Promise((resolve,reject)=>{const p=spawn(file,args,{cwd,stdio:'inherit',shell:false});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error('build_exit_'+c)));});
await run(process.execPath,['scripts/prepare-bundled-git.mjs']);
await run(process.execPath,['scripts/build-runtime.mjs']);
await run(process.execPath,['scripts/build-electron.mjs']);
await run(process.execPath,['scripts/prepare-installer-ui.mjs']);
await run(process.execPath,['scripts/prepare-installer-brand.mjs']);
// build-electron prepares the approved bird master for both the window and NSIS.
await run(process.execPath,[require.resolve('electron-builder/cli.js'),'--projectDir','electron-app','--win','--x64','--publish','never']);
