import {it,expect} from 'vitest';
// @ts-expect-error UI JavaScript module
import {outcome,inferDocumentTarget} from '../ui/run-outcome.js';
it('preserves a verified creation when Claude final response fails',()=>{const r=outcome({failed:true,errorCode:'claude_structured_output_failed',receipt:{kind:'create_document',status:'verified',mutated:true}});expect(r.documentVerified).toBe(true);expect(r.notice).toContain('변경은 유지');expect(r.text).not.toContain('완료하지 못');});
it('does not claim values were entered for an uncertain COM write',()=>{const r=outcome({receipt:{kind:'office_operations',status:'partial',mutated:true,completedWrites:0,nativeCode:'0x800A03EC'}});expect(r.documentVerified).toBe(false);expect(r.notice).toContain('입력 완료로 판정하지');});
it('recognizes current, explicit new and ambiguous creation destinations',()=>{expect(inferDocumentTarget('새 파일 만들어줘')).toBe('new');expect(inferDocumentTarget('현재 파일의 값을 수정해줘')).toBe('current');expect(inferDocumentTarget('주간 보고서를 만들어줘')).toBe(null);});
it('shows a created but unverified document accurately',()=>{const r=outcome({failed:true,receipt:{kind:'create_document',status:'partial',mutated:true}});expect(r.text).toContain('새 문서가 열렸');expect(r.documentVerified).toBe(false);});

it('keeps a later uncertain write visible even after an earlier verified edit',()=>{const r=outcome({failed:true,receipts:[{status:'verified',mutated:true},{status:'partial',mutated:true,completedWrites:0}]});expect(r.documentVerified).toBe(false);expect(r.notice).toContain('입력 완료로 판정하지');});
