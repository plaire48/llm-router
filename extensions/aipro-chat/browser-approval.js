import {canonicalJSON} from './canonical-json.js';
import {textDigest} from './browser-text.js';
import {fieldBaseline} from './field-marks.js';

// Static DOM inspection only. The model cannot issue grants or choose a
// stored selector: approvals bind to an actual node in an isolated world.
export function approvalTarget(el, operation = {}) {
  if(operation.method==='upload')return {label:String(el.getAttribute('aria-label')||[...el.labels||[]].map(n=>n.textContent).join(' ')||el.name||'파일 입력칸').trim().slice(0,100),action:'업로드'};
  if(operation.method==='download')return {label:'파일 다운로드',action:'다운로드'};
  // An image button is named by its alt text, as the browser names it. Measured
  // (H-03, candidate 42): a museum search form's <input type="image" alt="검색">
  // had no name here, so one search was held for approval as a form submission.
  const name = node => String(node?.getAttribute('aria-label') || node?.innerText || node?.value || node?.title ||
    (node?.matches?.('input[type="image"]') ? node.getAttribute('alt') : node?.querySelector?.('img[alt]')?.getAttribute('alt')) || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const key = String(operation.key || '');
  const control = el.closest('button,a,[role="button"],[role="link"],[onclick],[onpointerup],input[type="submit"]') || el;
  const label = name(control);
  // Keyboard submit/save shortcuts are actions, regardless of a field's
  // navigational-looking label. Never let a caption exempt those commands.
  if (operation.method === 'press' && /(?:Control|Meta|ControlOrMeta)\+(?:Shift\+)?[sS]$/.test(key)) return {label: '변경 내용 저장', action: '저장'};
  if (operation.method === 'press' && /(?:Control|Meta|ControlOrMeta)\+(?:Shift\+)?Enter$/.test(key)) return {label: label || '양식 제출', action: '제출'};
  // A field is not a button: text typed into it never names an action. Enter in
  // a field submits its form as the form's first submit button would.
  const editable = control.isContentEditable || control.matches('textarea,input:not([type=submit]):not([type=button]):not([type=image]):not([type=reset])');
  // A button's name can be long ("이번 분기 전체 신청 내역을 영구 삭제"); a link or a
  // row with a long caption is a mail subject or a title, not a command.
  const button = control.matches('button,[role="button"],input[type="submit"],input[type="button"],input[type="image"]');
  // Placement is not authority: a dialog's generic confirmation can commit a
  // purchase or delete data. Bind ambiguous confirmation to its own approval;
  // an earlier click's grant does not authorize a newly presented target.
  if (!editable) return finalAction(label, button ? 40 : 12);
  return operation.method === 'press' && key === 'Enter' && el.matches('input') && el.form
    ? finalAction(name([...el.form.elements].find(field => ['submit', 'image'].includes(field.type))), 40) : null;
  // A final action is named by its button, as the user reads it: a short caption
  // that ends with the verb (저장, 메일 보내기, 최종 반영) or, in English, starts
  // with it (Save, Send email). Reported by the user: guesses from form structure,
  // search forms and words inside long captions held ordinary clicks (닫기 in a
  // page-wide form, a search Enter, a mail subject) and asked for draft checks, and
  // "a click that works matters more". The approval card shows the draft itself.
  function finalAction(caption, limit) {
    const text = String(caption || '').replace(/\s+/g, ' ').trim();
    if (!text || /^(?:임시\s*저장|초안\s*저장|save\s+draft|preview|미리\s*보기)(?:하기)?$/i.test(text)) return null;
    // "확인" alone confirms; "결과 확인" or "예약 확인" looks something up.
    if (/^(?:확인(?:하기)?|ok|okay)$/i.test(text)) return {label: text, action: '확인'};
    const korean = [['저장', /저장/], ['발송', /전송|발송|보내기/], ['등록', /등록/], ['제출', /제출/], ['신청', /신청/], ['게시', /게시|발행/], ['삭제', /삭제/],
      ['결제', /결제|구매/], ['반영', /반영/], ['승인', /승인/], ['확정', /확정/], ['결재', /결재/], ['상신', /상신|(?:승인|결재|반영)\s*요청/], ['배포', /배포/]];
    const english = [['저장', /save(?: changes)?/], ['발송', /send/], ['제출', /submit/], ['게시', /post|publish/], ['삭제', /delete|remove/],
      ['결제', /pay|purchase|buy|checkout|place\s+order/], ['등록', /register/], ['승인', /approve/], ['배포', /deploy|release/], ['확인', /confirm/]];
    // "등록 후 목록 보기" registers first: each part of a joined caption is read.
    for (const part of text.split(/\s*(?:하고|\s후\s|\s및\s|,|&|\band\b|\bthen\b)\s*/i).filter(Boolean)) {
      const found = part.length <= limit && korean.find(([, pattern]) => new RegExp(`(?:${pattern.source})(?:하기|합니다)?$`).test(part)) ||
        part.length <= Math.max(limit, 24) && english.find(([, pattern]) => new RegExp(`^(?:${pattern.source})\\b`, 'i').test(part));
      if (found) return {label: text, action: found[0]};
    }
    return null;
  }
}

export function approvalPresentation(record) {
  const label = String(record.label || '').trim().replace(/\s+/g, ' ');
  const action = record.action || '실행';
  // A keyboard shortcut acts on a field; its label is not the command name.
  return {buttonLabel: !['press','upload','download'].includes(record.operation?.method) && label && label.length <= 32 ? label : action,
    text: /^(?:배포|게시|발송|등록|제출|신청|삭제|결제|저장|반영|승인|확정|결재|상신|실행|업로드|다운로드|확인)$/.test(action) ? `${action}할까요?` : '이 동작을 실행할까요?'};
}

function pageApproval({nonce, mode}) {
  const key = '__nubiActionApprovalV1', attr = 'data-nubi-action-approval';
  const roots = [document];
  for (let i=0;i<roots.length;i++) for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
  const marked = roots.flatMap(root=>[...root.querySelectorAll(`[${attr}="${nonce}"]`)]);
  const records = globalThis[key] ||= new Map();
  for (const [id,entry] of records) if (Date.now()-entry.at>600000) records.delete(id);
  if (mode === 'clear') {for(const el of marked)el.removeAttribute(attr);records.delete(nonce);return null;}
  if (mode === 'capture' && marked.length === 1) {
    records.set(nonce,{node:marked[0],at:Date.now()});marked[0].removeAttribute(attr);
    while(records.size>4)records.delete(records.keys().next().value);
  }
  const node=records.get(nonce)?.node, bound=!!node?.isConnected;
  if (mode === 'bind' && bound) node.setAttribute(attr,nonce);
  const fields=[];
  for (const root of roots) for (const el of root.querySelectorAll('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) {
    if(!el.getClientRects().length || el.type==='hidden')continue;
    const label=String(el.getAttribute('aria-label')||[...el.labels||[]].map(x=>x.textContent).join(' ')||el.name||el.id||'본문').trim().slice(0,100);
    if(/password|passwd|secret|token|api.?key|cc-|one-time-code|비밀번호|인증번호|카드번호/i.test(`${el.type} ${el.name} ${el.id} ${el.autocomplete} ${label}`))continue;
    const value=el.isContentEditable?el.innerText:['checkbox','radio'].includes(el.type)?String(el.checked):el.type==='file'?[...el.files].map(f=>`${f.name}:${f.size}:${f.lastModified}`).join(','):el.value;
    // A formatted draft can change without changing innerText. Bind its
    // visible structure and typography too; never return markup to the model.
    let format;
    if (el.isContentEditable) {
      const nodes = [el, ...el.querySelectorAll('*')].filter(node => node.getClientRects().length);
      if (nodes.length > 2000) throw new Error('approval_changed');
      format = nodes.map(node => {
        const css = getComputedStyle(node);
        return [node.tagName, ...['fontFamily','fontSize','fontWeight','fontStyle','textDecorationLine','color','backgroundColor','textAlign','lineHeight','marginTop','marginBottom'].map(key => css[key])];
      });
    }
    fields.push({label,value:String(value||''),...(format ? {format} : {}),multiline:el.isContentEditable||el.tagName==='TEXTAREA',editable:el.isContentEditable||el.tagName==='TEXTAREA'||el.tagName==='INPUT'&&!['checkbox','radio','file','button','submit','reset','image','range','color'].includes(el.type)});
  }
  const data={url:location.href,title:document.title,fields,...(bound?{target:{tag:node.tagName,label:node.getAttribute('aria-label')||node.innerText||node.value||node.title||'',type:node.type||'',accept:node.accept||'',multiple:!!node.multiple,href:node.href||'',linkTarget:node.target||'',form:node.formAction||node.form?.action||'',method:node.formMethod||node.form?.method||'',disabled:!!node.disabled}}:{})};
  if(JSON.stringify(data).length>450000)throw new Error('approval_changed');
  return {data,bound,targetRect:bound?{x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}:null,viewport:{width:innerWidth,height:innerHeight,x:scrollX,y:scrollY}};
}
const collect = (tabId,nonce,mode) => chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'ISOLATED',func:pageApproval,args:[{nonce,mode}]});
async function fingerprint(rows, operation) {
  const relevant=rows.filter(row=>row.frameId===0||row.result?.bound||row.result?.data.fields.length).map(row=>({documentId:row.documentId,data:row.result.data,...(operation.method==='point'?{viewport:row.result.viewport,targetRect:row.result.targetRect}:{})})).sort((a,b)=>a.documentId.localeCompare(b.documentId));
  return textDigest(canonicalJSON({operation,documents:relevant}));
}
export async function prepareApproval(task, handle, operation, details, summary = '') {
  const nonce=crypto.randomUUID();
  await handle.evaluate((el,nonce)=>el.setAttribute('data-nubi-action-approval',nonce),nonce);
  let rows;
  try {rows=await collect(task.tabId,nonce,'capture');}
  finally {await handle.evaluate((el,nonce)=>{if(el.getAttribute('data-nubi-action-approval')===nonce)el.removeAttribute('data-nubi-action-approval');},nonce).catch(()=>{});}
  const target=rows.filter(row=>row.result?.bound);
  if(target.length!==1 || !target[0].documentId)throw new Error('approval_changed');
  const top=rows.find(row=>row.frameId===0)?.result.data;
  const preview=rows.flatMap(row=>(row.result?.data.fields||[]).map((field,index)=>({...field,id:`${row.documentId}:${index}`}))).filter(field=>field.value).slice(0,4).map(field=>({id:field.id,label:field.label,value:field.value.slice(0,240),editable:field.editable}));
  if(operation.method==='upload')preview.unshift({label:'선택 파일',editable:false,value:operation.files.map(f=>`${f.name} (${f.bytes} bytes)`).join(', ').slice(0,240)},{label:'업로드 대상',editable:false,value:details.label});
  return {nonce,tabId:task.tabId,documentId:target[0].documentId,digest:await fingerprint(rows,operation),operation,expiresAt:Date.now()+600000,
    action:details.action,label:details.label,pageTitle:String(top?.title||'').slice(0,180),preview,hasEditableDraft:rows.some(row=>row.result?.data.fields.some(field=>field.editable)),summary:String(summary||'').slice(0,240),
    afterActions:(task.actionRevision||0)!==(task.approvalBaseRevision||0),...(fieldBaseline(task)?{fieldBaseline:fieldBaseline(task)}:{})};
}
export async function clearApproval(record) {if(record)await collect(record.tabId,record.nonce,'clear').catch(()=>{});}
const changedApproval = reason => Object.assign(new Error('approval_changed'), {reason});
export async function bindApproval(task,record) {
  if(record.expiresAt<=Date.now())throw changedApproval('approval_expired');
  if(task.tabId!==record.tabId)throw changedApproval('approval_scope_changed');
  const rows=await collect(record.tabId,record.nonce,'bind');
  try {
    if(!rows.some(row=>row.documentId===record.documentId&&row.result?.bound))throw changedApproval('approval_target_changed');
    if(await fingerprint(rows,record.operation)!==record.digest)throw changedApproval('approval_snapshot_changed');
    const handles=[];
    for(const frame of task.page.frames()) {
      const locator=frame.locator(`[data-nubi-action-approval="${record.nonce}"]`);
      if(await locator.count())handles.push(await locator.elementHandle());
    }
    if(handles.length!==1){await Promise.allSettled(handles.map(h=>h.dispose()));throw changedApproval('approval_target_changed');}
    if (record.operation.method === 'point' && !await handles[0].evaluate((el,{x,y}) => {const hit=document.elementFromPoint(x,y);return hit===el;},record.operation)) {await handles[0].dispose();throw changedApproval('approval_point_obscured');}
    return handles[0];
  } finally {await clearApproval(record);}
}

export async function readApprovalDraft(record) {
  if (!record || record.expiresAt <= Date.now()) throw new Error('approval_changed');
  const rows = await collect(record.tabId, record.nonce, 'read');
  if (!rows.some(row => row.documentId === record.documentId && row.result?.bound) || await fingerprint(rows, record.operation) !== record.digest) throw new Error('approval_changed');
  return rows.flatMap(row => (row.result?.data.fields || []).flatMap((field, index) => field.editable ? [{id: `${row.documentId}:${index}`, label: field.label, value: field.value, pageTitle: row.result.data.title, multiline: field.multiline}] : []));
}
