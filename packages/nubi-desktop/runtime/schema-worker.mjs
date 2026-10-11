import {parentPort, workerData} from 'node:worker_threads';
import {parseSchema} from './schema-parser.mjs';
import {readSQLiteSchema} from './sqlite-schema.mjs';
try { parentPort.postMessage(workerData.mode==='sqlite' ? readSQLiteSchema(workerData.filename) : {tables:parseSchema(workerData.content,workerData.dialect)}); }
catch (error) { parentPort.postMessage({error:['schema_snapshot_required','schema_unsupported','schema_limit'].includes(error.message) ? error.message : workerData.mode==='sqlite' ? 'database_unavailable' : 'schema_parse_failed'}); }
