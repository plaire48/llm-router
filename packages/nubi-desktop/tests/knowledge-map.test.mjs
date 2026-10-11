import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,symlink,unlink} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {stringify} from 'yaml';
import {fixture} from './fixtures.mjs';
import {hash} from '../runtime/files.mjs';
import {parseSchema} from '../runtime/schema-parser.mjs';
import {readSQLiteSchema} from '../runtime/sqlite-schema.mjs';
import {connectionOptions,collectInspector} from '../runtime/database-schema.mjs';
import {parseMetadata} from '../runtime/metadata-contract.mjs';

import {seedKnowledge} from './knowledge-fixture.mjs';

test('three SQL dialects extract definitions and reject migration replay and invalid SQL',()=>{
  for(const dialect of ['Postgresql','MySQL','SQLite']){
    const tables=parseSchema('CREATE TABLE parent (id INT PRIMARY KEY); CREATE TABLE child (parent_id INT REFERENCES parent(id));',dialect);
    assert.equal(tables[1].references[0].table,'parent');assert.deepEqual(tables[1].references[0].from,['parent_id']);
    assert.throws(()=>parseSchema('CREATE TABLE parent (id INT); ALTER TABLE parent ADD x INT;',dialect),/schema_snapshot_required/);
  }
  assert.throws(()=>parseSchema('hello database','Postgresql'));
});

test('actual SQLite metadata connects source, concepts, FK and Wiki without reading rows; change is compared and exported',async t=>{
  const {service,root}=await fixture(t);await seedKnowledge(root);
  const before=await readFile(path.join(root,'project.db'));
  const map=await service.knowledgeMap();assert.deepEqual(map.diagnostics,[]);assert.equal(map.comparisons[0].state,'matched_subset');
  assert.equal(map.nodes.find(n=>n.id==='table:live/main/customers').origin,'database');
  assert.ok(map.edges.some(e=>e.from==='column:live/main/orders/customer_id'&&e.to==='column:live/main/customers/id'));
  assert.doesNotMatch(JSON.stringify(map),/PRIVATE_ROW/);assert.deepEqual(await readFile(path.join(root,'project.db')),before);
  const query=await service.knowledgeQuery({query:'거래처'});assert.equal(query.focusId,'concept:customer');assert.ok(query.nodes.some(n=>n.id==='source:customer'));assert.ok(query.nodes.some(n=>n.id==='wiki:customer'));
  const saved=await service.exportKnowledgeMap({expectedFingerprint:map.fingerprint});assert.match(await readFile(path.join(root,saved.path),'utf8'),/DB 메타데이터/);
  const refreshed=await service.knowledgeMap();assert.ok(refreshed.nodes.every(n=>n.change==='matching'));
  const db=new DatabaseSync(path.join(root,'project.db'));db.exec('ALTER TABLE customers ADD email TEXT');db.close();
  const changed=await service.knowledgeMap();assert.ok(changed.comparisons[0].changes.some(c=>c.column==='email'&&c.type==='column_added'));assert.equal(changed.nodes.find(n=>n.id==='table:live/main/customers').change,'changed');
  await assert.rejects(service.exportKnowledgeMap({expectedFingerprint:map.fingerprint}),/source_stale/);
  assert.match(JSON.stringify(await service.wikiQuery({query:'프로젝트 지식 관계'})),/프로젝트 지식 관계/);
});

test('catalog refuses out-of-scope inputs, cycles and unresolved claims instead of implying completeness',async t=>{
  const {service,root,directory}=await fixture(t),config=await seedKnowledge(root);
  config.entities.push({id:'concept:account',kind:'concept',label:'계정'});config.relations.push({from:'concept:customer',to:'concept:account',type:'broader'},{from:'concept:account',to:'concept:customer',type:'broader'},{from:'source:customer',to:'table:missing',type:'writes'});
  await writeFile(path.join(root,'.nubi/knowledge.yaml'),stringify(config));const map=await service.knowledgeMap();assert.ok(map.diagnostics.some(d=>d.code==='concept_cycle'));assert.ok(map.diagnostics.some(d=>d.code==='relation_unresolved'));assert.equal(map.edges.filter(e=>e.type==='broader').length,0);
  config.entities[1].path='../outside';await writeFile(path.join(root,'.nubi/knowledge.yaml'),stringify(config));assert.equal((await service.knowledgeMap()).diagnostics[0].code,'catalog_invalid');
  config.entities[1].path='escape.txt';await writeFile(path.join(directory,'outside.txt'),'OUTSIDE_CONTENT');await symlink(path.join(directory,'outside.txt'),path.join(root,'escape.txt'));await writeFile(path.join(root,'.nubi/knowledge.yaml'),stringify(config));assert.doesNotMatch(JSON.stringify(await service.knowledgeMap()),/OUTSIDE_CONTENT/);
});

test('metadata import accepts another engine, validates structure and does not elevate imported facts to live evidence',async t=>{
  const {service,root}=await fixture(t),config=await seedKnowledge(root);
  const data={version:1,engine:'DB2',collectedAt:'2026-09-23T00:00:00Z',tables:[{schema:'APP',name:'CUSTOMERS',columns:[{name:'ID',type:'INTEGER',primary:true}],references:[]}]};
  assert.equal(parseMetadata(JSON.stringify(data)).engine,'DB2');assert.throws(()=>parseMetadata(JSON.stringify({...data,rows:[{secret:'X'}]})),/metadata_invalid/);
  await writeFile(path.join(root,'metadata.json'),JSON.stringify(data));config.schemas.push({id:'external',label:'DB2 가져오기',mode:'metadata',path:'metadata.json',defaultSchema:'APP'});await writeFile(path.join(root,'.nubi/knowledge.yaml'),stringify(config));
  const map=await service.knowledgeMap();assert.equal(map.nodes.find(n=>n.id==='table:external/APP/CUSTOMERS').origin,'imported');
});

test('connection options use bundled drivers and validated TLS; schema inspector projects metadata and omits ambiguous compound keys',async()=>{
  for(const engine of ['postgres','mysql','mariadb','sqlserver','oracle']){
    const config={engine,host:'localhost',port:1234,database:'db',schema:engine==='oracle'?'READER':['mysql','mariadb'].includes(engine)?'db':'public',user:'reader',password:'PRIVATE_PASSWORD',tls:true};
    const options=connectionOptions(config);assert.equal(options.debug,false);
    const client=(await import('knex')).default(options);assert.ok(client.client.driver);await client.destroy();
  }
  assert.throws(()=>connectionOptions({}),/database_config_invalid/);
  const inspector={tables:async()=>['customers'],columnInfo:async()=>[{name:'id',data_type:'INT',is_primary_key:true,default_value:'PRIVATE_DEFAULT'}],foreignKeys:async()=>[{constraint_name:'compound',column:'a',foreign_key_table:'x',foreign_key_column:'a'},{constraint_name:'compound',column:'b',foreign_key_table:'x',foreign_key_column:'b'}]};
  const normalized=await collectInspector(inspector,'public');assert.equal(normalized.tables[0].references.length,0);assert.doesNotMatch(JSON.stringify(normalized),/PRIVATE_DEFAULT/);assert.equal(normalized.relationCoverage,'single_column_foreign_keys');
});

test('failed remote connection is bounded, sanitized and never registered as connected',async t=>{
  const {service}=await fixture(t);
  await assert.rejects(service.databaseConnection({action:'connect',id:'unavailable',input:{engine:'postgres',host:'127.0.0.1',port:1,database:'db',schema:'public',user:'PRIVATE_USER',password:'PRIVATE_PASSWORD',tls:true}}),/^Error: database_connection_failed$/);
  assert.equal((await service.databaseConnection()).connections.length,0);
});

test('catalog starter preserves existing human files and a missing catalog does not hide a connected schema',async t=>{
  const {service,root}=await fixture(t);
  const first=await service.initializeKnowledgeCatalog();assert.equal(first.created,true);
  const bytes=await readFile(path.join(root,first.path),'utf8');assert.equal((await service.initializeKnowledgeCatalog()).created,false);assert.equal(await readFile(path.join(root,first.path),'utf8'),bytes);
  await unlink(path.join(root,first.path));
  const result={tables:[{schema:'public',name:'customers',columns:[{name:'id',type:'int',primary:true}],references:[]}]};
  service.databaseConnections.set('sales',{input:{schema:'public',engine:'postgres'},result,hash:hash(JSON.stringify(result)),collectedAt:'2026-09-23T00:00:00Z'});
  const map=await service.knowledgeMap();assert.ok(map.nodes.some(n=>n.id==='table:connected_sales/public/customers'));
  assert.match(JSON.stringify(map),/database_relation_partial/);
  await service.exportKnowledgeMap({expectedFingerprint:map.fingerprint});assert.ok((await service.knowledgeMap()).nodes.every(n=>n.change==='matching'));
});

test('SQLite and SQL snapshots preserve ordered composite and self-referencing foreign keys',async t=>{
  const {service,root}=await fixture(t);
  const ddl='CREATE TABLE parent (tenant INT, id INT, PRIMARY KEY (tenant,id)); CREATE TABLE child (tenant INT, parent_id INT, FOREIGN KEY (tenant,parent_id) REFERENCES parent(tenant,id)); CREATE TABLE staff (id INT PRIMARY KEY, manager_id INT REFERENCES staff(id));';
  const parsed=parseSchema(ddl,'SQLite');assert.deepEqual(parsed[1].references[0].from,['tenant','parent_id']);assert.deepEqual(parsed[1].references[0].to,['tenant','id']);
  const filename=path.join(root,'composite.db'),db=new DatabaseSync(filename);db.exec(ddl);db.close();
  const collected=readSQLiteSchema(filename);assert.deepEqual(collected.tables.find(t=>t.name==='child').references[0].to,['tenant','id']);
  await mkdir(path.join(root,'.nubi'));await writeFile(path.join(root,'.nubi/knowledge.yaml'),stringify({version:1,entities:[],schemas:[{id:'live',label:'SQLite',mode:'sqlite',path:'composite.db',defaultSchema:'main'}],relations:[]}));
  const map=await service.knowledgeMap();assert.deepEqual(map.diagnostics,[]);assert.ok(map.edges.some(e=>e.from==='table:live/main/staff'&&e.to===e.from&&e.type==='references'));
  const query=await service.knowledgeQuery({focusId:'database:live'});assert.ok(query.nodes.some(n=>n.id==='table:live/main/child'));
});
