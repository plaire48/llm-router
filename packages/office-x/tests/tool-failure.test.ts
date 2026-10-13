import {it,expect} from 'vitest';
// @ts-expect-error UI JavaScript module
import {toolFailure} from '../ui/run-outcome.js';
it('copies only structured execution fault metadata, preserving the actual member and code',async()=>{
 const failure=toolFailure({name:'inspect_office',isError:true,output:JSON.stringify({error:'office_member_not_found',failedMember:'Item',nativeCode:'0x80020003',request:'secret prompt',path:'C:/private/report.docx',diagnostics:{stage:'native_inspect_office',version:'0.8.1'}})});
 expect(failure).toMatchObject({tool:'inspect_office',member:'Item',code:'office_member_not_found',nativeCode:'0x80020003'});expect(JSON.stringify(failure)).not.toMatch(/secret|private/);expect(toolFailure({isError:true,output:'null'})).toBe(null);
});

it('retains the original exception HRESULT when a native runtime exception already supplied diagnostics',()=>{const r=toolFailure({name:'inspect_office',isError:true,output:JSON.stringify({error:'native_execution_failed',diagnostics:{exception:'MissingMemberException',nativeCode:'0x80131513',stage:'native_inspect_office',version:'0.8.1'}})});expect(r).toMatchObject({exception:'MissingMemberException',nativeCode:'0x80131513'});});

it('shows safe dotted paths and preserves failing stage in copied diagnostics',()=>{const r=toolFailure({name:'execute_office_operations',isError:true,output:JSON.stringify({error:'office_member_path_not_supported',failedMember:'TextFrame.TextRange.Font.Size',failureStage:'execute_step',exceptionName:'COMException'})});expect(r).toMatchObject({member:'TextFrame.TextRange.Font.Size',stage:'execute_step',exception:'COMException'});expect(toolFailure({name:'inspect_office',isError:true,output:JSON.stringify({error:'office_member_unavailable',failedMember:'C:/private/document.docx'})})?.member).toBeUndefined();});
