import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),binary=require('electron');
const child=spawn(binary,['electron-app'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});child.on('exit',code=>process.exit(code||0));
