import {parentPort,workerData} from 'node:worker_threads';
import {evaluateDocumentScript} from './script-vm.mjs';

try{parentPort.postMessage(await evaluateDocumentScript(workerData.code,workerData.inputJson,{compileOnly:workerData.compileOnly===true}));}
catch{parentPort.postMessage({error:'script_runtime_failed'});}
