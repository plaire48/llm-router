import {Worker} from 'node:worker_threads';
import {mkdir, realpath, writeFile, lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {parseDocument} from 'yaml';
import Ajv from 'ajv';
import {MultiDirectedGraph} from 'graphology';
import {hash, readSource, relativeFile, scopedFile, fail} from './files.mjs';
import {parseMetadata} from './metadata-contract.mjs';

export const CATALOG_PATH = '.nubi/knowledge.yaml';
const text = maxLength => ({type:'string',minLength:1,maxLength});
const array = (items,maxItems) => ({type:'array',items,maxItems});
const object = (properties,required) => ({type:'object',properties,required,additionalProperties:false});
const schema = object({
  version:{const:1},
  entities:array(object({id:{...text(200),pattern:'^(concept|source|wiki|requirement|document):[^\\s]+$'},kind:{enum:['concept','source','wiki','requirement','document']},label:text(160),description:text(1000),aliases:array(text(100),20),path:text(1000)},['id','kind','label']),100),
  schemas:array(object({id:{...text(80),pattern:'^[a-zA-Z0-9_-]+$'},label:text(160),path:text(1000),dialect:text(80),defaultSchema:text(100),mode:{enum:['ddl','sqlite','connection','metadata']},connectionId:text(80),compareTo:text(80)},['id','label','defaultSchema']),8),
  relations:array(object({from:text(500),to:text(500),type:{enum:['broader','related','implements','documents','reads','writes','represents','validates']}},['from','to','type']),300)
},['version','entities','schemas','relations']);
const validate = new Ajv({allErrors:true}).compile(schema);
const starter = `# 업무 개념과 코드, 스키마, Wiki의 연결을 Git으로 관리합니다.
# 파일 경로는 프로젝트 기준입니다. 저장 후 '관계 새로고침'을 누르세요.
version: 1
entities: []
# - id: concept:customer
#   kind: concept
#   label: 고객
#   aliases: [거래처, Customer]
# - id: source:customer
#   kind: source
#   label: 고객 조회
#   path: src/customer.ts
# - id: wiki:customer
#   kind: wiki
#   label: 고객 정책
#   path: openwiki/customer.md
schemas: []
# - id: sales
#   label: 영업 DB
#   path: db/schema.sql
#   dialect: Postgresql
#   defaultSchema: public
# 현재 구조의 CREATE TABLE 스냅샷을 지정하세요. 마이그레이션은 재생하지 않습니다.
# 실제 SQLite 연결: mode: sqlite / dialect: SQLite / defaultSchema: main
# path에 프로젝트 내부 DB 파일을 지정합니다. 행 데이터는 수집하지 않습니다.
# compareTo: <DDL 항목의 id>를 추가하면 테이블과 컬럼의 차이를 비교합니다.
# 원격 DB: mode: connection / connectionId: <DB 연결 화면의 연결 ID>
# 메타데이터 JSON: mode: metadata / path: <파일>. 다양한 DB 수집기를 연결합니다.
relations: []
# - {from: concept:customer, type: represents, to: table:sales/public/customers}
# - {from: source:customer, type: reads, to: table:sales/public/customers}
# - {from: wiki:customer, type: documents, to: concept:customer}
`;
const allowed = (relation,from,to) => {
  if (['broader','related'].includes(relation)) return from === 'concept' && to === 'concept';
  if (['reads','writes'].includes(relation)) return from === 'source' && ['database','table','column'].includes(to);
  if (relation === 'implements') return from === 'source' && ['concept','requirement'].includes(to);
  if (relation === 'documents') return ['wiki','document'].includes(from);
  if (relation === 'represents') return from === 'concept';
  return relation === 'validates' && ['source','document'].includes(from);
};
const tableId = (database,schema,table) => `table:${[database,schema,table].map(encodeURIComponent).join('/')}`;
const columnId = (table,column) => `column:${table.slice(6)}/${encodeURIComponent(column)}`;
const plain = value => String(value).replace(/[\r\n]/g,' ').replace(/[<>`|\[\]]/g,c => `&#${c.charCodeAt(0)};`);

function parseInWorker(workerData) {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./schema-worker.mjs',import.meta.url),{workerData,resourceLimits:{maxOldGenerationSizeMb:128},execArgv:[]});
    let settled=false;
    const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();resolve(result);};
    const timer=setTimeout(()=>finish({error:'schema_timeout'}),5000);
    worker.once('message',finish);worker.once('error',()=>finish({error:'schema_parse_failed'}));worker.once('exit',()=>finish({error:'schema_parse_failed'}));
  });
}

// Every relation carries a source hash. Neither existence nor a fresh hash proves
// that a human-declared business relationship is semantically correct.
export async function buildKnowledgeMap(root,{baseline=null,connections=new Map(),declaredOnly=false,ignore=null}={}) {
  const graph=new MultiDirectedGraph({allowSelfLoops:true}),diagnostics=[],files=new Map(),databases=new Map(),schemaResults=new Map();
  const issue=(code,file,detail)=>diagnostics.push({code,path:file,...(detail?{detail}: {})});
  const base={catalogPath:CATALOG_PATH,configured:false,nodes:[],edges:[],diagnostics,generatedAt:new Date().toISOString(),baselineAt:baseline?.createdAt || null,verification:'static_only'};
  const read=async rel=>{relativeFile(rel);if(ignore?.ignores(rel))fail('path_scope');if(files.has(rel))return files.get(rel);const file=await readSource(root,rel);files.set(rel,file);return file;};
  let catalog,config;
  try {catalog=await read(CATALOG_PATH);}
  catch(error){
    if(error.code!=='ENOENT'){issue('catalog_unreadable',CATALOG_PATH);return {...base,fingerprint:hash('no_catalog'),versions:{}};}
    catalog={path:CATALOG_PATH,hash:hash('no_catalog'),content:JSON.stringify({version:1,entities:[],schemas:[],relations:[]})};
  }
  base.configured=files.has(CATALOG_PATH);
  try {
    if(Buffer.byteLength(catalog.content)>128*1024)throw new Error();
    const doc=parseDocument(catalog.content,{uniqueKeys:true});
    if(doc.errors.length)throw new Error();
    config=doc.toJS({maxAliasCount:20});
    if(!validate(config))throw new Error();
    const ids=new Set();
    for(const entity of config.entities){if(ids.has(entity.id)||!entity.id.startsWith(entity.kind+':')||(entity.kind!=='concept'&&!entity.path))throw new Error();ids.add(entity.id);if(entity.path)relativeFile(entity.path);}
    const namespaces=new Set();
    for(const s of config.schemas){
      if(namespaces.has(s.id)||(s.mode==='sqlite'&&s.defaultSchema!=='main'))throw new Error();namespaces.add(s.id);
      if(s.mode==='connection'){if(!s.connectionId||s.path)throw new Error();}
      else {relativeFile(s.path);if((!s.mode||s.mode==='ddl')&&!['Postgresql','MySQL','SQLite'].includes(s.dialect))throw new Error();}
    }
  } catch {issue('catalog_invalid',CATALOG_PATH);return {...base,fingerprint:catalog.hash,versions:{[CATALOG_PATH]:catalog.hash}};}
  // Wiki retrieval needs declared vocabulary and links, not DB collection.
  if(declaredOnly){
    config.schemas=[];connections=new Map();
    config.relations=config.relations.filter(r=>![r.from,r.to].some(id=>/^(table|column|database):/.test(id)));
  }
  config.entities=config.entities.filter(entity=>!entity.path||!ignore?.ignores(entity.path));
  // A user-connected DB is immediately inspectable; only its public connection
  // ID belongs in a Git catalog. Credentials remain in the host's memory.
  const referenced=new Set(config.schemas.filter(s=>s.mode==='connection').map(s=>s.connectionId));
  for(const [id,connection] of connections)if(!referenced.has(id)){
    const namespace='connected_'+id;
    if(config.schemas.some(s=>s.id===namespace)){issue('connection_id_collision',CATALOG_PATH,id);continue;}
    config.schemas.push({id:namespace,label:id,mode:'connection',connectionId:id,defaultSchema:connection.input.schema});
  }
  const evidence=file=>({path:file.path,hash:file.hash});
  const node=(id,attributes)=>{if(graph.hasNode(id))throw new Error('duplicate_node');if(graph.order>=2000)throw new Error('graph_limit');graph.addNode(id,{id,...attributes});};
  const edge=(from,to,type,origin,sources)=>{
    if(!graph.hasNode(from)||!graph.hasNode(to)){issue('relation_unresolved',sources[0].path,`${from} → ${to}`);return;}
    if(from===to&&type!=='references'){issue('relation_self',sources[0].path,from);return;}
    const key=hash(JSON.stringify([from,to,type]));
    if(!graph.hasEdge(key))graph.addDirectedEdgeWithKey(key,from,to,{id:key,from,to,type,origin,evidence:sources});
  };
  for(const entity of config.entities){
    let source=null;
    if(entity.path){try{source=await read(entity.path);}catch{issue('source_unavailable',entity.path);}}
    node(entity.id,{...entity,origin:'declared',evidence:[evidence(catalog),...(source?[evidence(source)]:[])],availability:entity.path&&!source?'unavailable':'available'});
  }
  const references=[];
  for(const s of config.schemas){
    let source,result;
    const live=s.mode==='sqlite',remote=s.mode==='connection',imported=s.mode==='metadata',origin=live||remote?'database':imported?'imported':'sql';
    try {
      if(remote){
        const connection=connections.get(s.connectionId);
        if(!connection){issue('database_not_connected',CATALOG_PATH,s.connectionId);continue;}
        if(connection.input.schema!==s.defaultSchema){issue('database_schema_scope',CATALOG_PATH,s.id);continue;}
        result=connection.result;source={path:CATALOG_PATH,hash:connection.hash,resource:'database-schema:'+s.connectionId,collectedAt:connection.collectedAt};
        issue('database_relation_partial',CATALOG_PATH,s.id);
      }else if(imported){source=await read(s.path);result=parseMetadata(source.content);source={...source,collectedAt:result.collectedAt};}
      else if(live){
        const filename=await scopedFile(root,s.path);if(!(await lstat(filename)).isFile())throw new Error();
        result=await parseInWorker({mode:'sqlite',filename});
        if(!result.error){source={path:s.path,hash:hash(JSON.stringify(result)),resource:'sqlite-schema:'+s.path};databases.set(source.resource,{filename,source});}
      }else{source=await read(s.path);if(Buffer.byteLength(source.content)>64*1024)throw new Error();result=await parseInWorker({content:source.content,dialect:s.dialect});}
    }catch {issue(live?'database_unavailable':imported?'metadata_invalid':'schema_unreadable',s.path);continue;}
    if(result.error){issue(result.error,s.path);continue;}
    if(result.excluded)issue('database_objects_excluded',s.path,String(result.excluded));
    // Reject ambiguous duplicate definitions and oversized files atomically.
    const ids=result.tables.flatMap(t=>{const id=tableId(s.id,t.schema||s.defaultSchema,t.name);return [id,...t.columns.map(c=>columnId(id,c.name))];});
    if(new Set(ids).size!==ids.length||graph.order+ids.length+1>2000){issue('schema_duplicate_or_limit',s.path);continue;}
    schemaResults.set(s.id,{tables:result.tables.map(t=>({...t,schema:t.schema||s.defaultSchema})),path:s.path});
    const sources=[evidence(catalog),{...evidence(source),...(source.resource?{resource:source.resource}:{}),...(source.collectedAt?{collectedAt:source.collectedAt}:{})}],dbId='database:'+s.id,openPath=live||remote?undefined:s.path;
    node(dbId,{kind:'database',label:s.label,path:openPath,origin,availability:'available',evidence:sources});
    for(const t of result.tables){
      const id=tableId(s.id,t.schema||s.defaultSchema,t.name);
      node(id,{kind:'table',label:`${t.schema||s.defaultSchema}.${t.name}`,path:openPath,origin,availability:'available',evidence:sources});
      edge(dbId,id,'contains',origin,sources);
      for(const c of t.columns){const cid=columnId(id,c.name);node(cid,{kind:'column',label:c.name,dataType:c.type,primary:c.primary,path:openPath,origin,availability:'available',evidence:sources});edge(id,cid,'contains',origin,sources);}
      for(const ref of t.references)references.push({from:id,to:tableId(s.id,ref.schema||t.schema||s.defaultSchema,ref.table),ref,sources,origin});
    }
  }
  for(const {from,to,ref,sources,origin} of references){
    const pairs=ref.from.map((col,i)=>[columnId(from,col),columnId(to,ref.to[i])]);
    if(ref.from.length!==ref.to.length||pairs.some(([a,b])=>!graph.hasNode(a)||!graph.hasNode(b))){issue('foreign_key_unresolved',sources[1].path,`${from} → ${to}`);continue;}
    edge(from,to,'references',origin,sources);
    for(const [a,b] of pairs)edge(a,b,'references',origin,sources);
  }
  // A broader relation is directional. Do not infer new is-a / same-as facts.
  const broader=new MultiDirectedGraph({allowSelfLoops:true});
  for(const entity of config.entities.filter(e=>e.kind==='concept'))broader.addNode(entity.id);
  for(const r of config.relations){
    if(!graph.hasNode(r.from)||!graph.hasNode(r.to)){issue('relation_unresolved',CATALOG_PATH,`${r.from} → ${r.to}`);continue;}
    if(r.from===r.to||!allowed(r.type,graph.getNodeAttribute(r.from,'kind'),graph.getNodeAttribute(r.to,'kind'))){issue('relation_invalid',CATALOG_PATH,`${r.from} → ${r.to}`);continue;}
    if(r.type==='broader')broader.mergeDirectedEdge(r.from,r.to);
    const sources=new Map([...graph.getNodeAttribute(r.from,'evidence'),...graph.getNodeAttribute(r.to,'evidence')].map(e=>[e.path,e]));
    edge(r.from,r.to,r.type,'declared',[...sources.values()]);
  }
  const active=new Set(),done=new Set();let cyclic=false;
  const visit=id=>{if(active.has(id)){cyclic=true;return;}if(done.has(id))return;active.add(id);broader.forEachOutNeighbor(id,visit);active.delete(id);done.add(id);};
  broader.forEachNode(visit);
  if(cyclic){issue('concept_cycle',CATALOG_PATH);graph.forEachEdge((key,a)=>{if(a.type==='broader')graph.dropEdge(key);});}
  const versions=Object.fromEntries([...files].map(([file,record])=>[file,record.hash]).concat([...databases].map(([key,{source}])=>[key,source.hash])));
  if(!base.configured)versions[CATALOG_PATH]=catalog.hash;
  graph.forEachNode((id,a)=>{for(const e of a.evidence)if(e.resource?.startsWith('database-schema:'))versions[e.resource]=e.hash;});
  const unstable=new Set();
  for(const [file,record] of files){try{if(ignore?.ignores(file)||(await readSource(root,file)).hash!==record.hash)unstable.add(file);}catch{unstable.add(file);}}
  for(const [key,{filename,source}] of databases){const current=await parseInWorker({mode:'sqlite',filename});if(current.error||hash(JSON.stringify(current))!==source.hash)unstable.add(key);}
  for(const file of unstable)issue('changed_during_scan',file);
  const nodes=graph.mapNodes((id,a)=>({...a,change:a.availability==='unavailable'?'unavailable':a.evidence.some(e=>unstable.has(e.resource||e.path))?'unstable':!baseline?'unrecorded':a.evidence.some(e=>baseline.versions[e.resource||e.path]!==e.hash)?'changed':'matching'}));
  const edges=graph.mapEdges((id,a)=>a);
  const comparisons=config.schemas.filter(s=>s.compareTo).map(s=>compareSchemas(schemaResults.get(s.compareTo),schemaResults.get(s.id),s));
  return {...base,nodes,edges,versions,comparisons,fingerprint:hash(JSON.stringify({versions,nodes:nodes.map(({change,...n})=>n),edges,diagnostics,comparisons})),counts:{nodes:nodes.length,edges:edges.length},baselinePath:baseline?.path || null};
}

function compareSchemas(before,after,config){
  if(!before||!after)return {id:config.id,baseline:config.compareTo,state:'unavailable',changes:[]};
  // Explicit comparison is local-schema to local-schema; cross-schema mappings
  // must be curated instead of guessed from similar names.
  const flatten=tables=>new Map(tables.map(t=>[`${t.schema||config.defaultSchema}/${t.name}`,t]));
  const left=flatten(before.tables),right=flatten(after.tables),changes=[];
  for(const [id,t] of left){
    if(!right.has(id)){changes.push({table:id,type:'table_missing'});continue;}
    const old=new Map(t.columns.map(c=>[c.name,c])),now=new Map(right.get(id).columns.map(c=>[c.name,c]));
    for(const [col,c] of old){const n=now.get(col);if(!n)changes.push({table:id,column:col,type:'column_missing'});else if(c.type.toUpperCase()!==n.type.toUpperCase()||c.primary!==n.primary)changes.push({table:id,column:col,type:'column_changed'});}
    for(const col of now.keys())if(!old.has(col))changes.push({table:id,column:col,type:'column_added'});
  }
  for(const id of right.keys())if(!left.has(id))changes.push({table:id,type:'table_added'});
  return {id:config.id,baseline:config.compareTo,state:changes.length?'different':'matched_subset',changes:changes.slice(0,200),truncated:changes.length>200,scope:'table_column_type_primary_key_only'};
}

export function queryKnowledgeMap(map,{query='',focusId,depth=2}={}) {
  if(typeof query!=='string'||query.length>500||!Number.isInteger(depth)||depth<1||depth>2)fail('input_invalid');
  const text=query.normalize('NFC').toLowerCase().trim();
  const matches=map.nodes.filter(n=>[n.id,n.label,...(n.aliases||[])].some(v=>v.normalize('NFC').toLowerCase().includes(text))).slice(0,20);
  const focus=focusId || matches[0]?.id;
  const graph=new MultiDirectedGraph({allowSelfLoops:true});
  for(const n of map.nodes)graph.addNode(n.id,n);
  for(const e of map.edges)graph.addDirectedEdgeWithKey(e.id,e.from,e.to,e);
  if(focus&&!graph.hasNode(focus))fail('knowledge_node_missing');
  const visited=new Map(focus?[[focus,0]]:[]),queue=focus?[focus]:[];let truncated=false;
  for(let i=0;i<queue.length;i++){
    const id=queue[i],distance=visited.get(id);if(distance>=depth)continue;
    graph.forEachEdge(id,(key,e,from,to)=>{
      // Avoid treating all tables in a database as mutually affected.
      if(graph.getNodeAttribute(focus,'kind')!=='database'&&e.type==='contains'&&(graph.getNodeAttribute(from,'kind')==='database'||graph.getNodeAttribute(to,'kind')==='database'))return;
      const next=from===id?to:from;if(visited.has(next))return;
      if(visited.size>=40){truncated=true;return;}visited.set(next,distance+1);queue.push(next);
    });
  }
  const edges=map.edges.filter(e=>visited.has(e.from)&&visited.has(e.to));
  return {focusId:focus || null,matches,nodes:[...visited].map(([id,distance])=>({...graph.getNodeAttributes(id),distance})),edges:edges.slice(0,120),truncated:truncated||edges.length>120,fingerprint:map.fingerprint,diagnostics:map.diagnostics,comparisons:map.comparisons,
    instruction:'정적 관계에 따른 확인 후보입니다. 관계의 방향을 확인하세요. 선언과 SQL 분석은 실제 실행을 증명하지 않습니다. 연결되지 않은 영향도 확인해야 합니다.'};
}

export async function initializeKnowledgeCatalog({taskId}={}) {
  const root=await this.target(taskId),folder=path.join(root,'.nubi');
  try{if(await realpath(folder)!==folder)fail('path_scope');}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(folder);}
  const target=await scopedFile(root,CATALOG_PATH,{newFile:true});
  try{await writeFile(target,starter,{flag:'wx'});}catch(error){if(error.code==='EEXIST')return {path:CATALOG_PATH,created:false};throw error;}
  return {path:CATALOG_PATH,created:true};
}

export async function knowledgeMap({taskId}={}) {
  this.ready();const root=await this.target(taskId);
  return buildKnowledgeMap(root,{baseline:this.store.get('knowledge-map:'+hash(root)),connections:this.databaseConnections});
}
export async function knowledgeQuery(args={}) {return queryKnowledgeMap(await knowledgeMap.call(this,args),args);}

export async function exportKnowledgeMap({taskId,expectedFingerprint}) {
  if(this.recordingKnowledge)fail('knowledge_busy');this.recordingKnowledge=true;
  try {
    const root=await this.target(taskId),map=await knowledgeMap.call(this,{taskId});
    if(map.fingerprint!==expectedFingerprint)fail('source_stale');
    if(!map.nodes.length||map.diagnostics.some(d=>d.code==='changed_during_scan'))fail('knowledge_incomplete');
    let folder=root;
    for(const part of ['openwiki','nubi-map']){folder=path.join(folder,part);try{if(await realpath(folder)!==folder)fail('path_scope');}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(folder);}}
    const rel=`openwiki/nubi-map/${randomUUID()}.md`;
    const content=`---\ntitle: 프로젝트 지식 관계\n---\n\n# 프로젝트 지식 관계\n\n기록 시점: ${map.generatedAt}\n\n스냅샷: ${map.fingerprint}\n\n연결 정보를 정리한 기록입니다. 현재 DB 상태와 실제 동작은 별도 확인이 필요합니다.\n\n## 항목\n\n`+
      map.nodes.map(n=>`- ${plain(n.label)} (${plain(n.kind)}, ${plain(n.id)})${n.path?` — [원본](../../${n.path.split('/').map(encodeURIComponent).join('/')})`:''}${n.dataType?` (${plain(n.dataType)})`:''}`).join('\n')+
      '\n\n## 관계\n\n'+map.edges.map(e=>`- ${plain(e.from)} → ${plain(e.type)} → ${plain(e.to)} (${({sql:'SQL 추출',database:'DB 메타데이터',declared:'목록에 선언',imported:'가져온 메타데이터'})[e.origin]})`).join('\n')+
      '\n\n## 스키마 대조\n\n'+(map.comparisons.map(c=>`- ${plain(c.baseline)} → ${plain(c.id)}: ${c.state}\n`+c.changes.map(d=>`  - ${plain(d.table)} ${plain(d.column||'')}: ${d.type}`).join('\n')).join('\n')||'- 대조 대상 미지정')+
      '\n\n## 출처 버전\n\n'+Object.entries(map.versions).map(([file,version])=>`- ${plain(file)}: ${version}`).join('\n')+
      '\n\n## 확인 필요\n\n'+(map.diagnostics.map(d=>`- ${plain(d.path)}: ${plain(d.code)}`).join('\n')||'- 수집 오류 없음. 실행 및 의미 검증은 별도입니다.')+'\n';
    if(Buffer.byteLength(content)>1024*1024)fail('knowledge_incomplete');
    await writeFile(await scopedFile(root,rel,{newFile:true}),content,{flag:'wx'});
    if((await readSource(root,rel)).hash!==hash(content))fail('write_unconfirmed');
    this.store.set('knowledge-map:'+hash(root),{versions:map.versions,path:rel,createdAt:map.generatedAt});
    return {path:rel,hash:hash(content)};
  } finally {this.recordingKnowledge=false;}
}
