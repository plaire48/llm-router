import Knex from 'knex';
import {SchemaInspector} from 'knex-schema-inspector';

export const DATABASE_ENGINES={postgres:{client:'pg',port:5432},mysql:{client:'mysql2',port:3306},mariadb:{client:'mysql2',port:3306},sqlserver:{client:'mssql',port:1433},oracle:{client:'oracledb',port:1521}};
const clean=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\x00-\x1f]/.test(value);

export function connectionOptions(input){
  if(!input||!DATABASE_ENGINES[input.engine]||!clean(input.host)||!clean(input.database)||!clean(input.user)||!clean(input.schema)||typeof input.password!=='string'||input.password.length>4096||!Number.isInteger(input.port)||input.port<1||input.port>65535||typeof input.tls!=='boolean')throw new Error('database_config_invalid');
  if(!/^[a-zA-Z0-9.:-]+$/.test(input.host)||!/^[a-zA-Z0-9_$#.-]+$/.test(input.database)||input.schema.includes(','))throw new Error('database_config_invalid');
  if(input.engine==='oracle'&&input.schema!==input.user.toUpperCase())throw new Error('database_schema_scope');
  if(['mysql','mariadb'].includes(input.engine)&&input.schema!==input.database)throw new Error('database_schema_scope');
  const {host,port,database,user,password}=input;
  const common={host,port,database,user,password};
  let connection;
  if(input.engine==='postgres')connection={...common,ssl:input.tls?{rejectUnauthorized:true}:false,connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000,application_name:'nubi-schema-reader'};
  else if(['mysql','mariadb'].includes(input.engine))connection={...common,ssl:input.tls?{rejectUnauthorized:true}:undefined,connectTimeout:5000,multipleStatements:false};
  else if(input.engine==='sqlserver')connection={...common,server:host,options:{encrypt:input.tls,trustServerCertificate:false,connectTimeout:5000,requestTimeout:5000,appName:'nubi-schema-reader'}};
  else connection={user,password,connectString:`${input.tls?'tcps':'tcp'}://${host}:${port}/${database}?transport_connect_timeout=5&retry_count=0&ssl_server_dn_match=true`,sslServerDNMatch:true};
  return {client:DATABASE_ENGINES[input.engine].client,connection,pool:{min:0,max:1},acquireConnectionTimeout:6000,debug:false,log:{warn(){},error(){},debug(){},deprecate(){}}};
}

// Inspector's PG extractor deliberately excludes compound FKs; Oracle's source
// can cross-product compound key columns. Emit only single-column constraints
// and explicitly retain this coverage gap, rather than manufacturing lineage.
export async function collectInspector(inspector,schema){
  const names=(await inspector.tables()).sort();if(names.length>100)throw new Error('schema_limit');
  const tables=[];
  for(const table of names){
    if(!clean(table))throw new Error('schema_unsupported');
    const columns=await inspector.columnInfo(table),foreign=await inspector.foreignKeys(table);
    if(columns.length>300||foreign.length>1000)throw new Error('schema_limit');
    const groups=new Map();
    for(const fk of foreign){const key=fk.constraint_name || `${fk.column}:${fk.foreign_key_table}:${fk.foreign_key_column}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(fk);}
    tables.push({schema,name:table,columns:columns.map(c=>({name:c.name,type:c.data_type||'unknown',primary:!!c.is_primary_key})),references:[...groups.values()].filter(rows=>rows.length===1).map(([f])=>({schema:f.foreign_key_schema||schema,table:f.foreign_key_table,from:[f.column],to:[f.foreign_key_column]}))});
  }
  return {tables,relationCoverage:'single_column_foreign_keys',consistency:'sequential_metadata_reads'};
}

export async function readDatabaseSchema(input){
  const database=Knex(connectionOptions(input));
  try{
    const inspector=SchemaInspector(database);
    if(typeof inspector.withSchema==='function')inspector.withSchema(input.schema);
    return await collectInspector(inspector,input.schema);
  }finally{await database.destroy();}
}
