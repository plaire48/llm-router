import {textDigest} from './browser-text.js';

// Static DOM inspection only. The model cannot issue grants or choose a
// stored selector: approvals bind to an actual node in an isolated world.
export function approvalTarget(el, operation = {}) {
  const name = node => String(node?.getAttribute('aria-label') || node?.innerText || node?.value || node?.title || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const key = String(operation.key || '');
  const control = el.closest('button,a,[role="button"],[role="link"],[onclick],[onpointerup],input[type="submit"]') || el;
  const label = name(control);
  // Keyboard submit/save shortcuts are actions, regardless of a field's
  // navigational-looking label. Never let a caption exempt those commands.
  if (operation.method === 'press' && /(?:Control|Meta|ControlOrMeta)\+(?:Shift\+)?[sS]$/.test(key)) return {label: '변경 내용 저장', action: '저장'};
  if (operation.method === 'press' && /(?:Control|Meta|ControlOrMeta)\+(?:Shift\+)?Enter$/.test(key)) return {label: label || '양식 제출', action: '제출'};
  if (/^(?:임시\s*저장|초안\s*저장|save\s+draft|preview|미리\s*보기)(?:하기)?$/i.test(label)) return null;
  // Opening an application history or registration form is a preparation
  // step. Do not mistake the subject of a clearly navigational link for its
  // final action. Bare submit/send/delete labels still require approval.
  const submitsForm = control.form && ['submit', 'image'].includes(control.type);
  // Navigation may be implemented by a button as well as an anchor. Keep a
  // real form submit guarded even when its caption sounds like navigation.
  if (operation.method !== 'press' && !submitsForm && !/(?:하고|\s후\s|\s및\s|\band\b|\bthen\b|&)/i.test(label) && /(?:(?:내역|목록|상세|화면|페이지|양식)(?:\s*(?:보기|열기))?|조회|작성(?:하기)?|(?:view|open)\s+.*(?:history|details?|form|page)|(?:history|details?|form)\s+(?:view|page))$/i.test(label)) return null;
  const actions = [['배포', /배포|deploy\b|release\b/i], ['게시', /게시|발행|publish\b/i], ['발송', /보내기|발송|전송|send\b/i], ['등록', /등록|register\b/i], ['제출', /제출|submit\b/i], ['신청', /신청|apply\b/i], ['삭제', /삭제|delete\b/i], ['결제', /결제|구매|purchase\b|pay\b/i], ['저장', /^(?:저장|저장하기|변경\s*저장|save(?: changes)?)$/i]];
  const editable = el.isContentEditable || el.matches('textarea,input:not([type=submit]):not([type=button]):not([type=image])');
  // The last Korean action is the verb: "신청 내역 삭제" means deletion,
  // while "삭제 신청" means application. English captions put it first.
  const action = !editable && (actions.find(([, pattern]) => new RegExp(`(?:${pattern.source})(?:하기)?$`, 'i').test(label)) || actions.find(([, pattern]) => pattern.test(label)));
  if (action) return {label, action: action[0]};
  if (control.form && ['submit', 'image'].includes(control.type) && !/^(?:검색|찾기|search|find)$/i.test(label)) return {label: label || '양식 제출', action: '제출'};
  if (operation.method === 'press' && key === 'Enter' && el.matches('input') && el.form) return {label: label || '양식 제출', action: '제출'};
  return null;
}

export function approvalPresentation(record) {
  const label = String(record.label || '').trim().replace(/\s+/g, ' ');
  const action = record.action || '실행';
  // A keyboard shortcut acts on a field; its label is not the command name.
  return {buttonLabel: record.operation?.method !== 'press' && label && label.length <= 32 ? label : action,
    text: /^(?:배포|게시|발송|등록|제출|신청|삭제|결제|저장|실행)$/.test(action) ? `${action}할까요?` : '이 동작을 실행할까요?'};
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
  const data={url:location.href,title:document.title,fields,...(bound?{target:{tag:node.tagName,label:node.getAttribute('aria-label')||node.innerText||node.value||node.title||'',type:node.type||'',href:node.href||'',linkTarget:node.target||'',form:node.formAction||node.form?.action||'',method:node.formMethod||node.form?.method||'',disabled:!!node.disabled}}:{})};
  if(JSON.stringify(data).length>450000)throw new Error('approval_changed');
  return {data,bound,targetRect:bound?{x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}:null,viewport:{width:innerWidth,height:innerHeight,x:scrollX,y:scrollY}};
}
const collect = (tabId,nonce,mode) => chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'ISOLATED',func:pageApproval,args:[{nonce,mode}]});
async function fingerprint(rows, operation) {
  const relevant=rows.filter(row=>row.frameId===0||row.result?.bound||row.result?.data.fields.length).map(row=>({documentId:row.documentId,data:row.result.data,...(operation.method==='point'?{viewport:row.result.viewport,targetRect:row.result.targetRect}:{})})).sort((a,b)=>a.documentId.localeCompare(b.documentId));
  return textDigest(JSON.stringify({operation,documents:relevant}));
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
  const preview=rows.flatMap(row=>row.result?.data.fields||[]).filter(field=>field.value).slice(0,4).map(field=>({label:field.label,value:field.value.slice(0,240)}));
  return {nonce,tabId:task.tabId,documentId:target[0].documentId,digest:await fingerprint(rows,operation),operation,expiresAt:Date.now()+600000,
    action:details.action,label:details.label,pageTitle:String(top?.title||'').slice(0,180),preview,hasEditableDraft:rows.some(row=>row.result?.data.fields.some(field=>field.editable)),summary:String(summary||'').slice(0,240),
    afterActions:(task.actionRevision||0)!==(task.approvalBaseRevision||0)};
}
export async function clearApproval(record) {if(record)await collect(record.tabId,record.nonce,'clear').catch(()=>{});}
export async function bindApproval(task,record) {
  if(record.expiresAt<=Date.now()||task.tabId!==record.tabId)throw new Error('approval_changed');
  const rows=await collect(record.tabId,record.nonce,'bind');
  try {
    if(!rows.some(row=>row.documentId===record.documentId&&row.result?.bound)||await fingerprint(rows,record.operation)!==record.digest)throw new Error('approval_changed');
    const handles=[];
    for(const frame of task.page.frames()) {
      const locator=frame.locator(`[data-nubi-action-approval="${record.nonce}"]`);
      if(await locator.count())handles.push(await locator.elementHandle());
    }
    if(handles.length!==1){await Promise.allSettled(handles.map(h=>h.dispose()));throw new Error('approval_changed');}
    if (record.operation.method === 'point' && !await handles[0].evaluate((el,{x,y}) => {const hit=document.elementFromPoint(x,y);return hit===el;},record.operation)) {await handles[0].dispose();throw new Error('approval_changed');}
    return handles[0];
  } finally {await clearApproval(record);}
}

export async function readApprovalDraft(record) {
  if (!record || record.expiresAt <= Date.now()) throw new Error('approval_changed');
  const rows = await collect(record.tabId, record.nonce, 'read');
  if (!rows.some(row => row.documentId === record.documentId && row.result?.bound) || await fingerprint(rows, record.operation) !== record.digest) throw new Error('approval_changed');
  return rows.flatMap(row => (row.result?.data.fields || []).flatMap((field, index) => field.editable ? [{id: `${row.documentId}:${index}`, label: field.label, value: field.value, pageTitle: row.result.data.title, multiline: field.multiline}] : []));
}
