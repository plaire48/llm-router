import {parentPort,workerData} from 'node:worker_threads';
import {readDatabaseSchema} from './database-schema.mjs';
try {parentPort.postMessage(await readDatabaseSchema(workerData));}
catch(error){parentPort.postMessage({error:['database_config_invalid','database_schema_scope','schema_limit','schema_unsupported'].includes(error.message)?error.message:'database_connection_failed'});}
