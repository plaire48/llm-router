import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,lstat,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const formats={word:['doc','docx','docm','dot','dotx','dotm','rtf'],excel:['xls','xlsx','xlsm','xlt','xltx','xltm'],powerpoint:['ppt','pptx','pptm','pps','ppsx','ppsm','pot','potx','potm']};
const mimes={'application/msword':'doc','application/vnd.ms-excel':'xls','application/vnd.ms-powerpoint':'ppt','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','application/vnd.openxmlformats-officedocument.wordprocessingml.template':'dotx','application/vnd.ms-word.document.macroenabled.12':'docm','application/vnd.ms-word.template.macroenabled.12':'dotm','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.template':'xltx','application/vnd.ms-excel.sheet.macroenabled.12':'xlsm','application/vnd.ms-excel.template.macroenabled.12':'xltm','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx','application/vnd.openxmlformats-officedocument.presentationml.slideshow':'ppsx','application/vnd.openxmlformats-officedocument.presentationml.template':'potx','application/vnd.ms-powerpoint.presentation.macroenabled.12':'pptm','application/vnd.ms-powerpoint.slideshow.macroenabled.12':'ppsm','application/vnd.ms-powerpoint.template.macroenabled.12':'potm'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function officeDocumentFormat(filename='',contentType=''){
  const suffix=path.extname(String(filename||'')).slice(1).toLowerCase();
  if(/^(pdf|txt|md|csv|json|xml|html?|png|jpe?g|gif|webp)$/.test(suffix))return null;
  const extension=Object.values(formats).flat().includes(suffix)?suffix:mimes[String(contentType||'').split(';')[0].trim().toLowerCase()];
  const app=Object.keys(formats).find(key=>formats[key].includes(extension));
  return app?{app,extension}:null;
}
const failures=new Set(['document_limit','document_empty','document_office_missing','document_office_version','document_office_policy','document_office_read_failed','mail_source_changed']);
let officeQueue=Promise.resolve();

// Only a byte-identical copy inside the account's ACL-restricted raw directory
// is opened. No ZIP editor, decrypted sidecar, macro, save or format conversion.
export async function readOfficeDocument(bytes,attachment,options={}){
  let release;const previous=officeQueue;officeQueue=new Promise(resolve=>{release=resolve;});
  try{await previous;if(options.signal?.aborted)throw Error('mail_cancelled');return await readOfficeDocumentNow(bytes,attachment,options);}
  finally{release();}
}
async function readOfficeDocumentNow(bytes,attachment,{signal,directory,restrictDirectory}={}){
  if(process.platform!=='win32')throw Error('document_office_required');
  const format=officeDocumentFormat(attachment.filename,attachment.contentType);
  if(!format)throw Error('document_format');
  if(signal?.aborted)throw Error('mail_cancelled');
  if(bytes.length>10*1024*1024)throw Error('document_limit');
  if(!directory||typeof restrictDirectory!=='function')throw Error('document_office_policy');
  const parent=await lstat(directory);if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('mail_source_changed');
  let temporary;
  try{
    temporary=await mkdtemp(path.join(directory,'office-read-'));
    await restrictDirectory(temporary);
    const file=path.join(temporary,'document.'+format.extension),expectedHash=sha(bytes);
    await writeFile(file,bytes,{flag:'wx',mode:0o600});
    if(sha(await readFile(file))!==expectedHash)throw Error('mail_source_changed');
    const script=await readFile(new URL('./office-document.ps1',import.meta.url),'utf8');
    const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','USERNAME','USERDOMAIN','HOMEDRIVE','HOMEPATH','PATH'])if(process.env[key])env[key]=process.env[key];
    const binary=path.win32.join(env.SystemRoot||env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const result=await new Promise((resolve,reject)=>{
      if(signal?.aborted)return reject(Error('mail_cancelled'));
      const child=spawn(binary,['-NoLogo','-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{stdio:['pipe','pipe','pipe'],windowsHide:true,env});
      const chunks=[];let size=0,failure,settled=false;
      const stop=code=>{failure ||= code;child.kill();};
      const abort=()=>stop('mail_cancelled');
      const timer=setTimeout(()=>stop('document_office_timeout'),60000);
      signal?.addEventListener('abort',abort,{once:true});
      child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1024*1024)stop('document_limit');else chunks.push(chunk);});
      child.stderr.resume();child.stdin.on('error',()=>{});
      child.once('error',()=>{failure ||= 'document_office_missing';});
      child.once('close',code=>{
        if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
        if(failure)return reject(Error(failure));
        let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));}catch{return reject(Error('document_office_policy'));}
        if(value.error||code!==0)return reject(Error(failures.has(value.error)?value.error:'document_office_read_failed'));
        const document=value.document;
        if(document?.reader!=='office_com'||!/^16\./.test(document.officeVersion||'')||typeof document?.text!=='string'||!document.text.trim()||document.text.length>100000||typeof document.coverage!=='string'||document.coverage.length>2000||!Array.isArray(document.segments)||document.segments.length>1000||document.segments.some(segment=>typeof segment.text!=='string'||segment.text.length>100000))return reject(Error('document_office_read_failed'));
        resolve(document);
      });
      child.stdin.end(JSON.stringify({file,app:format.app,expectedHash}));
    });
    if(signal?.aborted)throw Error('mail_cancelled');
    if(sha(await readFile(file))!==expectedHash)throw Error('mail_source_changed');
    return result;
  }finally{
    // A timed-out Office call may still hold its read-only file. Never kill a
    // user's Office process or close an unrelated document to force cleanup.
    if(temporary)await rm(temporary,{recursive:true,force:true}).catch(()=>{throw Error('document_office_cleanup');});
  }
}
