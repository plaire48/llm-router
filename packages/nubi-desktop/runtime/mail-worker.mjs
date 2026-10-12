import {configureSystemTrust} from './worker-environment.mjs';
import {parentPort,workerData} from 'node:worker_threads';
import {pullPop3} from '../../openwiki/src/connectors/sources/pop3.mjs';
try{configureSystemTrust();parentPort.postMessage({result:await pullPop3(workerData)});}
catch(error){if(error.message==='system_ca_unavailable')error=new Error('mail_tls_unavailable');parentPort.postMessage({error:/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_connection_failed'});}
