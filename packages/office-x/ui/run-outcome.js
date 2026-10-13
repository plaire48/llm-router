const errors={office_repeated_tool_failure:'문서 도구에서 같은 오류가 반복되어 작업을 멈췄습니다.',no_credential:'모델 연결을 먼저 확인해주세요.',claude_cli_timeout:'Claude 응답 시간이 초과됐습니다.',claude_turn_limit:'Claude의 응답 처리 한도에 도달했습니다.',claude_structured_output_failed:'Claude가 문서 도구 응답을 올바른 형식으로 마치지 못했습니다.',claude_response_invalid:'Claude의 도구 응답 형식을 확인해야 합니다.',claude_cli_missing:'Claude Code를 찾지 못했습니다.',claude_login_required:'Claude에 다시 로그인해 주세요.',claude_cli_failed:'Claude Code 실행을 완료하지 못했습니다.',rate_limited:'Claude 사용 한도에 도달했습니다.',provider_response_failed:'모델의 후속 응답을 받지 못했습니다.'};
export function outcome(message){
 const receipts=message.receipts||[message.receipt].filter(Boolean),verified=receipts.filter(r=>r.status==='verified'),created=receipts.find(r=>r.kind==='create_document'&&r.mutated),partial=receipts.find(r=>r.status==='partial');
 const reason=errors[message.errorCode]||'모델 응답을 마치지 못했습니다.';
 if(created&&created.status!=='verified')return {text:message.text||'새 문서가 열렸습니다. 내용 확인이 필요합니다.',notice:'생성된 문서의 최종 검증을 마치지 못했습니다. 문서 화면에서 실제 내용을 확인하세요.',tone:'warning',documentVerified:false};
 if(partial)return {text:message.text||'문서 변경 결과를 확인해야 합니다.',notice:'실제 적용 여부를 확인하지 못했습니다. 입력 완료로 판정하지 않았습니다.',tone:'warning',documentVerified:false};
 if(message.failed&&verified.length)return {text:message.text||'문서 작업 결과를 확인했습니다.',notice:reason+' 확인된 문서 변경은 유지됩니다. 남은 작업만 이어서 요청하세요.',tone:'warning',documentVerified:true};
 return {text:message.text||(message.failed?reason:message.cancelled?'작업을 중지했습니다.':''),notice:message.failed?reason:'',tone:'danger',documentVerified:verified.length>0};
}
export function inferDocumentTarget(request){if(/새\s*(문서|파일|통합문서|워크북|발표자료|창)|새로\s*(만들|작성|생성)|new\s+(document|file|workbook|presentation)/i.test(request))return 'new';if(/현재|이\s*(문서|파일|표|시트|슬라이드)|수정|바꿔|고쳐|선택한|기존|여기|이어서/.test(request))return 'current';return /만들|작성|생성|제작/.test(request)?null:'current';}

export function toolFailure(execution){
 if(!execution?.isError)return null;
 let result;try{result=JSON.parse(execution.output);}catch{return null;}
 const safe=value=>typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(value)?value:undefined;
 const code=safe(result?.error);if(!code)return null;
 const source=result.diagnostics||{};
 return {code,tool:safe(execution.name),member:safe(result.failedMember||source.member),nativeCode:/^0x[0-9a-f]{8}$/i.test(result.nativeCode||source.nativeCode||'')?result.nativeCode||source.nativeCode:undefined,stage:safe(source.stage),id:typeof source.id==='string'&&/^[a-f0-9]{12}$/i.test(source.id)?source.id:undefined,version:typeof source.version==='string'&&/^\d+\.\d+\.\d+$/.test(source.version)?source.version:undefined};
}
