const errors={agent_tool_input_failed:'모델이 문서 작업 인자를 올바르게 만들지 못했습니다.',agent_tool_failed:'문서 도구 실행에 실패했습니다. 아래 오류 정보를 확인해 주세요.',agent_no_progress:'같은 문서 요청이 반복되어 진행하지 못했습니다.',agent_response_unverified:'문서 작업 결과와 모델 응답이 일치하지 않습니다.',agent_failed:'Agent 처리 중 오류가 발생했습니다. 확인된 문서 결과를 먼저 확인해 주세요.',office_repeated_tool_failure:'문서 도구에서 같은 오류가 반복되어 작업을 멈췄습니다.',no_credential:'모델 연결을 먼저 확인해주세요.',claude_cli_timeout:'Claude 응답 시간이 초과됐습니다.',claude_turn_limit:'Claude의 응답 처리 한도에 도달했습니다.',claude_structured_output_failed:'Claude가 문서 도구 응답을 올바른 형식으로 마치지 못했습니다.',claude_response_invalid:'Claude의 도구 응답 형식을 확인해야 합니다.',claude_cli_missing:'Claude Code를 찾지 못했습니다.',claude_login_required:'Claude에 다시 로그인해 주세요.',claude_cli_failed:'Claude Code 실행을 완료하지 못했습니다.',rate_limited:'Claude 사용 한도에 도달했습니다.',provider_response_failed:'모델의 후속 응답을 받지 못했습니다.'};
export function outcome(message){
 const receipts=message.receipts||[message.receipt].filter(Boolean),verified=receipts.filter(r=>r.status==='verified'),created=receipts.find(r=>r.kind==='create_document'&&r.mutated),partial=receipts.find(r=>r.status==='partial'&&!r.recoveryReviewed);
 const reason=errors[message.errorCode]||'모델 응답을 마치지 못했습니다.';
 const exported=receipts.find(r=>r.kind==='save_markdown'&&r.saved===true);
 if(exported&&(exported.status==='partial'||message.failed))return {text:message.text||'Markdown 파일 저장을 확인했습니다.',notice:(message.failed?reason+' 저장된 파일은 유지됩니다. ':'')+(exported.status==='partial'?(exported.warnings?.[0]||'추출한 내용을 원문과 대조해 주세요.'):'저장 확인이 끝났습니다.'),tone:'warning',documentVerified:false,fileVerified:true};
 if(created&&created.status!=='verified')return {text:message.text||'새 문서가 열렸습니다. 내용 확인이 필요합니다.',notice:'생성된 문서의 최종 검증을 마치지 못했습니다. 완료로 처리하지 않았습니다.',tone:'warning',documentVerified:false};
 if(partial)return {text:message.text||'문서 변경 결과를 확인해야 합니다.',notice:'문서 상태 확인이 필요합니다.',tone:'warning',documentVerified:false};
 if(message.failed&&verified.length)return {text:message.text||'문서 작업 결과를 확인했습니다.',notice:reason+' 확인된 문서 변경은 유지됩니다.',tone:'warning',documentVerified:true};
 return {text:message.text||(message.failed?reason:message.cancelled?'작업을 중지했습니다.':''),notice:message.failed?reason:'',tone:'danger',documentVerified:verified.length>0};
}
export function inferDocumentTarget(request){if(/마크다운|markdown|\.md\b/i.test(request)&&/읽|저장|추출|뽑|내보|export|save/i.test(request)&&!/새\s*(통합문서|워크북|발표자료|슬라이드)|new\s+(workbook|presentation)|\.(docx|xlsx|pptx)\b/i.test(request))return 'current';if(/새\s*(문서|파일|통합문서|워크북|발표자료|창)|새로\s*(만들|작성|생성)|new\s+(document|file|workbook|presentation)/i.test(request))return 'new';if(/현재|이\s*(문서|파일|표|시트|슬라이드)|수정|바꿔|고쳐|선택한|기존|여기|이어서/.test(request))return 'current';return /만들|작성|생성|제작/.test(request)?null:'current';}

export function toolFailure(execution){
 if(!execution?.isError)return null;
 let result;try{result=JSON.parse(execution.output);}catch{return null;}
 const safe=value=>typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(value)?value:undefined;
 const safeMember=value=>typeof value==='string'&&value.length<=100&&/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value)?value:undefined;
 const code=safe(result?.error);if(!code)return null;
 const previous=result.error==='writes_stopped_for_this_run'&&result.previousFailure&&typeof result.previousFailure==='object'?result.previousFailure:{};
 const source=result.diagnostics||{};
 const path=result.inputPath||source.inputPath;
 const countChecks=Array.isArray(result.checks||previous.checks)?(result.checks||previous.checks).filter(c=>/^(?:[A-Za-z_][A-Za-z0-9_]*\.)*Count$/i.test(c?.read?.member||'')&&Number.isSafeInteger(c.actual)&&c.actual>=0&&Number.isSafeInteger(c.expected)&&c.expected>=0).slice(0,10).map(c=>({actual:c.actual,expected:c.expected,passed:c.passed===true})):[];
 return {code,cause:safe(previous.error),countChecks,tool:safe(execution.name),member:safeMember(result.failedMember||previous.failedMember||source.member),inputPath:typeof path==='string'&&path.length<=150&&/^[A-Za-z_][A-Za-z0-9_]*(\[\d{1,3}\]|\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(path)?path:undefined,inputRule:safe(result.inputRule||source.inputRule),nativeCode:/^0x[0-9a-f]{8}$/i.test(result.nativeCode||previous.nativeCode||source.nativeCode||'')?result.nativeCode||previous.nativeCode||source.nativeCode:undefined,exception:safe(result.exceptionName||source.exception),stage:safe(result.failureStage||source.failureStage||source.stage),id:typeof source.id==='string'&&/^[a-f0-9]{12}$/i.test(source.id)?source.id:undefined,version:typeof source.version==='string'&&/^\d+\.\d+\.\d+$/.test(source.version)?source.version:undefined};
}
export function documentInputFailure(fault){
 if(fault?.code==='writes_stopped_for_this_run'){const c=fault.countChecks?.find(c=>!c.passed);return c?`앞선 개수 검증 실패로 후속 쓰기를 멈췄습니다. 예상 ${c.expected}개, 실제 ${c.actual}개입니다. 이미 적용된 내용을 먼저 확인해야 합니다.`:'사용자 확인 후 현재 문서에서 이어갈 수 있습니다.';}
 if(fault?.inputRule==='worksheet_required')return '시트 목록에 이름을 적용하려던 요청을 쓰기 전에 중단했습니다. 실제 시트를 찾아 이름을 변경해야 합니다.';
 if(fault?.code==='office_count_expectation_invalid')return '문서를 변경하기 전에 예상 개수 오류를 발견했습니다. 실제 개수를 읽고 변경안을 다시 확인해야 합니다.';
 if(fault?.code==='readback_mismatch'&&fault.countChecks?.some(c=>!c.passed)){const c=fault.countChecks.find(c=>!c.passed);return `개수 확인: 예상 ${c.expected}개, 실제 ${c.actual}개. 셀 내용의 확인 결과도 함께 확인해야 합니다. 변경을 반복하지 않습니다.`;}
 if(fault?.code!=='document_content_invalid')return '';
 const path=fault.inputPath||'',cell=/^sheets\[(\d+)\]\.rows\[(\d+)\](?:\[(\d+)\])?$/.exec(path),sheet=/^sheets\[(\d+)\]\.name$/.exec(path);
 const location=cell?`${+cell[1]+1}번째 시트 ${+cell[2]+1}행${cell[3]!==undefined?` ${+cell[3]+1}열`:''}`:sheet?`${+sheet[1]+1}번째 시트 이름`:path==='title'?'문서 제목':'문서 내용';
 const reasons={sheet_name_invalid:'Excel에서 사용할 수 없는 시트 이름입니다.',sheet_name_duplicate:'같은 시트 이름이 중복되었습니다.',unsupported_control_character:'지원하지 않는 제어 문자가 포함되어 있습니다.',row_required:'행에 셀 내용이 필요합니다.',text_required:'셀 내용은 텍스트로 전달해야 합니다.',title_required:'문서 제목이 필요합니다.'};
 const limit=/^max_(length|rows|columns|sheets|content)_(\d+)$/.exec(fault.inputRule||''),units={length:'자',rows:'행',columns:'열',sheets:'개 시트',content:'자'};
 const reason=reasons[fault.inputRule]||(limit?`한 번에 ${limit[2]}${units[limit[1]]}까지 작성할 수 있습니다.`:'작성 형식을 다시 확인해야 합니다.');
 return `${location}: ${reason} 아직 문서를 변경하지 않았습니다.`;
}
