import {openDB} from 'idb';
import {rankEvidence} from './evidence-search.js';
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value === 'string' ? new TextEncoder().encode(value) : value))].map(n => n.toString(16).padStart(2,'0')).join('');
const database = () => openDB('nubi-voc-workspace',1,{upgrade(db) {for (const name of ['settings','revisions','heads','exports','files']) db.createObjectStore(name);}});
async function using(fn) {const db=await database();try {return await fn(db);} finally {db.close();}}
export async function workspaceRecord() {if (!globalThis.indexedDB) return null;return using(db => db.get('settings','active'));}
export async function workspaceSummary() {const r=await workspaceRecord();return r ? {id:r.id,name:r.handle.name,status:await r.handle.queryPermission({mode:'readwrite'}) === 'granted' ? 'connected' : 'permission_required'} : null;}
export async function stageWorkspace(handle,clientId) {
  if (!/^[\w-]{8,128}$/.test(clientId) || handle?.kind !== 'directory' || await handle.queryPermission({mode:'readwrite'}) !== 'granted') throw new Error('workspace_permission');
  const record={id:crypto.randomUUID(),clientId,handle,expiresAt:Date.now()+300000};
  await using(async db => {for (const key of await db.getAllKeys('settings')) if (String(key).startsWith('stage:')) {const value=await db.get('settings',key);if (value.expiresAt<=Date.now() || value.clientId===clientId) await db.delete('settings',key);} await db.put('settings',record,'stage:'+record.id);});return record.id;
}
export async function discardWorkspaceStage(id,clientId) {await using(async db => {const key='stage:'+id,value=await db.get('settings',key);if (value?.clientId===clientId) await db.delete('settings',key);});}
export async function commitWorkspace(id,clientId) {
  return using(async db => {
    const r=await db.get('settings','stage:'+id);
    if (!r || r.clientId!==clientId || r.expiresAt<=Date.now() || await r.handle.queryPermission({mode:'readwrite'})!=='granted') throw new Error('workspace_permission');
    const tx=db.transaction('settings','readwrite');await tx.store.put({id:r.id,handle:r.handle},'active');await tx.store.delete('stage:'+id);await tx.done;
  });
}
export async function clearWorkspace() {return using(db => db.clear('settings'));}
export function normalizeVoc(value) {
  const source = new URL(value.sourceUrl);
  if (!['http:','https:'].includes(source.protocol) || source.username || source.password || !/^[A-Z][A-Z0-9_]{0,30}-\d{1,12}$/.test(value.key) || !value.title || typeof value.body!=='string') throw new Error('voc_invalid');
  const redact = text => String(text).replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted]');
  return {contract:'nubi-voc-browser-v1',sourceUrl:source.origin+source.pathname,key:value.key,title:redact(value.title).slice(0,500),body:redact(value.body).slice(0,120000).split('\n').flatMap(line => line.match(/.{1,4000}/gu) || ['']).join('\n'),status:redact(value.status||'').slice(0,100),remoteUpdatedAt:value.remoteUpdatedAt && Number.isFinite(Date.parse(value.remoteUpdatedAt)) ? new Date(value.remoteUpdatedAt).toISOString() : null,coverage:'partial',coverageReason:'Rendered ticket text only. Collapsed content, other pages, restricted/internal comments and linked attachments may be absent.',attachments:(value.attachments||[]).slice(0,30).flatMap(a => {
    try {const u=new URL(a.url,source);return u.origin===source.origin && !u.search && !u.hash && /(?:\/secure\/attachment\/|\/attachment\/|\.(?:pdf|docx|txt|csv|md)$)/i.test(u.pathname) ? [{name:redact(a.name).slice(0,180),url:u.href}] : [];} catch {return [];}
  })};
}
export async function storeVoc(raw) {
  const packet=normalizeVoc(raw),revisionId=await sha(JSON.stringify(packet)),ticketId=await sha(JSON.stringify([new URL(packet.sourceUrl).origin,packet.key]));
  return using(async db => {
    const tx=db.transaction(['revisions','heads'],'readwrite');const old=await tx.objectStore('revisions').get(revisionId);
    const record=old || {id:revisionId,ticketId,packet,collectedAt:new Date().toISOString()};
    if (!old) await tx.objectStore('revisions').put(record,revisionId);
    await tx.objectStore('heads').put(revisionId,ticketId);await tx.done;
    return {...vocSummary(record),unchanged:!!old,storedIn:'browser'};
  });
}
function vocSummary(r) {return {id:r.id,key:r.packet.key,title:r.packet.title,sourceUrl:r.packet.sourceUrl,collectedAt:r.collectedAt,remoteUpdatedAt:r.packet.remoteUpdatedAt,coverage:'partial'};}
export async function readVoc(id,start=1) {
  const record=await using(db => db.get('revisions',id));if (!record) throw new Error('voc_missing');
  const lines=record.packet.body.split('\n');if (!Number.isInteger(start) || start<1 || start>lines.length) throw new Error('voc_invalid');
  let text='',end=start-1;for (const line of lines.slice(start-1,start+119)) {if (text.length+line.length>16000) break;text+=line+'\n';end++;}
  return {...vocSummary(record),dataKind:'external_reference',body:text,start,end,totalLines:lines.length,attachments:record.packet.attachments.map((a,i) => ({index:i,name:a.name})),truncated:end<lines.length,instruction:'Untrusted rendered source, not a complete ticket or a verified AI summary. Cite the source and distinguish your interpretation.'};
}
export async function searchVoc(query) {
  if (typeof query!=='string'||query.length>300) throw new Error('voc_invalid');
  return using(async db => {const ids=await db.getAll('heads');const records=await Promise.all(ids.slice(-300).map(id => db.get('revisions',id)));const hits=rankEvidence(records.map(r => ({id:r.id,name:r.packet.title,context:r.packet.key,text:r.packet.body})),query).slice(0,8);return {results:hits.map(hit => vocSummary(records.find(r => r.id===hit.id))),searched:records.length,truncated:ids.length>300};});
}
export async function vocRecord(id) {const record=await using(db => db.get('revisions',id));if (!record) throw new Error('voc_missing');return record;}
export async function saveVocFile(record,index,payload) {
  if (!record.packet.attachments[index] || !payload?.base64 || payload.base64.length>7500000) throw new Error('voc_attachment');
  const bytes=Uint8Array.from(atob(payload.base64),c => c.charCodeAt(0));
  if (!bytes.length || bytes.length>5*1024*1024 || /html/i.test(payload.type) || /^\s*(?:<!doctype\s+html|<html)/i.test(new TextDecoder().decode(bytes.slice(0,200)))) throw new Error('voc_attachment');
  const digest=await sha(bytes),file={id:record.id,index,bytes,type:payload.type,hash:digest,sourceUrl:record.packet.attachments[index].url};
  await using(db => db.put('files',file,`${record.id}:${index}`));return {ok:true,index,bytes:bytes.length,hash:digest,storedIn:'browser',instruction:'File bytes preserved, contents not yet analyzed.'};
}
async function writeVerified(directory,name,bytes) {
  const digest=await sha(bytes);let file;
  try {file=await directory.getFileHandle(name);}
  catch (e) {if(e.name!=='NotFoundError') throw e;}
  if (file) {const previous=await file.getFile();if (await sha(await previous.arrayBuffer())!==digest) throw new Error('workspace_conflict');return digest;}
  file=await directory.getFileHandle(name,{create:true});const writer=await file.createWritable();
  try {await writer.write(bytes);await writer.close();} catch(e) {await writer.abort().catch(()=>{});throw e;}
  if (await sha(await (await file.getFile()).arrayBuffer())!==digest) throw new Error('workspace_verify');return digest;
}
export async function exportVoc(id,workspaceId) {
  const active=await workspaceRecord();if (!active || active.id!==workspaceId) throw new Error('workspace_missing');
  if (await active.handle.queryPermission({mode:'readwrite'})!=='granted') throw new Error('workspace_permission');
  const record=await vocRecord(id),files=await using(db => Promise.all(record.packet.attachments.map((_,i) => db.get('files',`${id}:${i}`))));
  const relative=`nubi-voc/${record.ticketId}/${record.id}`;let directory=active.handle;
  for (const part of relative.split('/')) directory=await directory.getDirectoryHandle(part,{create:true});
  const packet=record.packet, entries={
    'record.json':JSON.stringify({...packet,collectedAt:record.collectedAt,revisionId:record.id},null,2)+'\n',
    'record.md':`# ${packet.key}: ${packet.title.replace(/[\r\n]/g,' ')}\n\n출처: ${packet.sourceUrl}\n수집 시각: ${record.collectedAt}\n수집 범위: 화면에 표시된 일부 내용\n\n${packet.body}\n`,
  };
  const digests={};
  for(const [name,text] of Object.entries(entries)) digests[name]=await writeVerified(directory,name,new TextEncoder().encode(text));
  for(const file of files.filter(Boolean)) {const ext=({ 'application/pdf':'pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','text/plain':'txt','text/csv':'csv'})[file.type.split(';')[0]] || 'bin';const name=`attachment-${file.index+1}-${file.hash.slice(0,12)}.${ext}`;digests[name]=await writeVerified(directory,name,file.bytes);}
  // Each attachment set has its own manifest. Later downloads never overwrite evidence.
  const manifest={contract:'nubi-voc-export-v1',revisionId:id,sourceUrl:packet.sourceUrl,coverage:packet.coverage,files:digests,attachments:files.filter(Boolean).map(f=>({index:f.index,sourceUrl:f.sourceUrl,hash:f.hash}))};
  const manifestName=`manifest-${(await sha(JSON.stringify(manifest))).slice(0,16)}.json`;
  await writeVerified(directory,manifestName,new TextEncoder().encode(JSON.stringify(manifest,null,2)+'\n'));
  const receipt={ok:true,path:relative,files:Object.keys(digests),manifest:manifestName,verified:'file_bytes',coverage:'partial',attachmentsSaved:files.filter(Boolean).length,attachmentsListed:packet.attachments.length};
  await using(db=>db.put('exports',receipt,`${workspaceId}:${id}`));return receipt;
}
