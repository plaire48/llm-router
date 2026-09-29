import {Buffer} from 'buffer/index.js';
import {assertBrowserPolicy,refreshBrowserPolicy} from './browser-policy.js';
import {readAttachment} from './attachment-store.js';
export function uploadMetadata(chat) {
  return [...new Map((chat?.messages || []).filter(m=>m.role==='user').flatMap(m=>m.attachments||[]).map(f=>[f.id,f])).values()]
    .map(({id,name,bytes,mimeType,hash})=>({id,name,bytes,mimeType,hash}));
}
export async function uploadFiles(chat, ids, expected) {
  if (!Array.isArray(ids) || !ids.length || ids.length>4 || new Set(ids).size!==ids.length) throw new Error('tool_arguments_invalid');
  const available=uploadMetadata(chat), files=[];
  for (const id of ids) {
    const meta=available.find(f=>f.id===id);
    if (!meta || expected && !expected.some(f=>f.id===id&&f.hash===meta.hash)) throw new Error('attachment_missing');
    const file=await readAttachment(id,{provider:chat.provider,conversationId:chat.sessionId});
    const bytes=new Uint8Array(await file.blob.arrayBuffer());
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if (hash!==meta.hash || file.hash!==hash || bytes.length!==meta.bytes) throw new Error('attachment_missing');
    files.push({meta,bytes});
  }
  if(files.reduce((n,f)=>n+f.bytes.length,0)>8*1024*1024)throw new Error('attachment_size');
  return files;
}
export async function startDownload(owner, url) {
  await refreshBrowserPolicy(); assertBrowserPolicy(url,'DownloadsEnabled');
  if(!await chrome.permissions.contains({permissions:['downloads']}))throw new Error('download_permission');
  const {browserTransfers=[]}=await chrome.storage.local.get('browserTransfers');
  // Persist intent before calling Chrome. Lost replies stay unknown and are never retried.
  const receipt={id:crypto.randomUUID(),provider:owner.provider,conversationId:owner.conversationId,requestId:owner.id,status:'unknown',createdAt:Date.now()};
  const transfers=[...browserTransfers.slice(-99),receipt];
  await chrome.storage.local.set({browserTransfers:transfers});
  try {
    receipt.downloadId=await chrome.downloads.download({url,saveAs:false,conflictAction:'uniquify'});
    receipt.status='in_progress'; await chrome.storage.local.set({browserTransfers:transfers});
  } catch(error) { // A rejected API call does not authorize a retry of an uncertain request.
    receipt.reason='download_request_unconfirmed';await chrome.storage.local.set({browserTransfers:transfers});throw error;
  }
  return {transfer_id:receipt.id,state:receipt.status,instruction:'Read download_status with this transfer_id. Chrome completion is not content integrity or server persistence proof.'};
}
export async function downloadStatus(owner, id) {
  const {browserTransfers=[]}=await chrome.storage.local.get('browserTransfers');
  const receipt=browserTransfers.find(r=>r.id===id&&r.provider===owner.provider&&r.conversationId===owner.conversationId);
  if(!receipt)throw new Error('download_missing');
  if(Number.isInteger(receipt.downloadId)) {
    if(!await chrome.permissions.contains({permissions:['downloads']}))throw new Error('download_permission');
    const [item]=await chrome.downloads.search({id:receipt.downloadId});
    if(item) {
      await refreshBrowserPolicy();
      try {assertBrowserPolicy(item.finalUrl||item.url,'DownloadsEnabled');}
      catch {if(item.state==='in_progress')await chrome.downloads.cancel(item.id).catch(()=>{});receipt.status='blocked';}
      if(receipt.status!=='blocked')receipt.status=item.state;
      receipt.filename=String(item.filename||'').split(/[\\/]/).at(-1).slice(0,200);
      receipt.bytesReceived=item.bytesReceived;receipt.totalBytes=item.totalBytes;receipt.error=item.error||null;
      receipt.existsReported=item.exists;receipt.danger=item.danger;
    } else receipt.status='unavailable';
    await chrome.storage.local.set({browserTransfers});
  }
  return {transfer_id:receipt.id,state:receipt.status,filename:receipt.filename,bytesReceived:receipt.bytesReceived,totalBytes:receipt.totalBytes,error:receipt.error,
    existsReported:receipt.existsReported,danger:receipt.danger,verified:false,instruction:'State comes from Chrome downloads. exists may be cached; completion does not verify file contents. Never restart unknown/interrupted transfers automatically.'};
}

export const playwrightFiles = files => files.map(f=>({name:f.meta.name,mimeType:f.meta.mimeType,buffer:Buffer.from(f.bytes)}));
