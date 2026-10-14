// Detect a preparation-only stop, never infer success or replay a mutation.
export function preparationOnly(request:string,permission:unknown,ledger:readonly {tool:string;status?:string}[],attempted:boolean):boolean{
 if(permission==='read'||attempted||!ledger.some(x=>['load_office_guide','read_template'].includes(x.tool)))return false;
 if(/방법|설명|예시|하지\s*(?:마|말)|않고|읽기만|읽어만|how\s+to|explain|do\s+not|don't/i.test(request))return false;
 if(!/작성|수정|변경|입력|생성|만들|바꿔|넣어|교체|삽입|적용|편집|create|write|edit|modify|insert|replace/i.test(request))return false;
 return ledger.every(x=>x.status==='read'&&/^(read_template|load_office_guide|inspect_office|inspect_office_members|read_selection|read_outline|read_range|read_cells|read_worksheets|read_sheet_context|read_surrounding)$/.test(x.tool));
}
export const preparationCorrection='The requested document action has not been performed. Loading an editing guide and reading document structure are preparation, not task completion. Continue the original request now: inspect the bound current document, use its actual snapshot and native handles, perform the requested edit through native tools under the selected permission mode, then verify readback. Do not stop with a promise to start or ask for duplicate approval. Do not create a different document unless the selected target requests it. If the task is only explanatory, answer it; if genuinely blocked, state the concrete blocker. Never replay any prior mutation.';
