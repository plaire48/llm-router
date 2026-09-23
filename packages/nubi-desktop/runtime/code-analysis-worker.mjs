import {parentPort,workerData} from 'node:worker_threads';
import {analyzeCode} from './code-analysis-core.mjs';
try{parentPort.postMessage(analyzeCode(workerData));}catch{parentPort.postMessage({error:'analysis_unavailable'});}
