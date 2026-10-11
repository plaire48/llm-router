import {parentPort,workerData} from 'node:worker_threads';
import {pullPop3} from '../../openwiki/src/connectors/sources/pop3.mjs';
try{parentPort.postMessage({result:await pullPop3(workerData)});}
catch(error){parentPort.postMessage({error:/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_connection_failed'});}
