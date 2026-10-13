using System;
using System.IO;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;
using OfficeX.Core;
using Excel=Microsoft.Office.Interop.Excel;

namespace OfficeX.ExcelHost
{
    public sealed class OfficePane : UserControl
    {
        private readonly ExcelPort port;
        private readonly TextPort textPort;
        private readonly string app;
        private TextSession textSession;
        private object fallbackContext;
        private object Context => fallbackContext??(app=="excel"?(object)session.Context:textSession.Context);
        private readonly object application;
        private readonly int windowHandle;
        private OfficeAutomationPort automationPort;
        private OfficeAutomationSession automation;
        private DocumentCreationPort creationPort;
        private bool writesStopped,createdDuringRun;
        private string documentTarget="current",currentStage="host";
        private OfficeFiles files;
        private OfficePane followOwner;
        private readonly List<OfficePane> followers=new List<OfficePane>();
        private JObject lastProvider,lastReceipt,lastServices;
        public event Action<int> DocumentWindowChanged;
        public bool IsRunning=>running;
        private JObject handoffState,pendingReview;
        private readonly List<JObject> followMessages=new List<JObject>();
        private JObject HandoffState()=>JObject.FromObject(new{type="handoff",app,conversationId,runId,request=request.Text,text=answer.Text,target=target.Text,running,model=(string)lastProvider?["state"]?["model"]});
        public void FollowSession(OfficePane owner){if(ReferenceEquals(owner,this))return;followMessages.Clear();files=owner.files?.Fork(()=>automationPort);if(files!=null)surface.SetAssetsRoot(files.Folder);followOwner=owner;owner.followers.Add(this);handoffState=owner.HandoffState();lastProvider=owner.lastProvider;lastServices=owner.lastServices;lastReceipt=owner.lastReceipt;ReplayFollow();}
        private void ReplayFollow(){if(handoffState==null)return;if(followOwner!=null)handoffState=followOwner.HandoffState();surface.Send(handoffState);if(lastProvider!=null)surface.Send(lastProvider);if(lastServices!=null)surface.Send(lastServices);if(lastReceipt!=null&&!followMessages.Any(m=>(string)m["type"]=="receipt"))surface.Send(lastReceipt);foreach(var message in followMessages)surface.Send(message);if(followOwner?.pendingQuestion!=null)surface.Send(followOwner.pendingQuestion);if(followOwner?.pendingReview!=null)surface.Send(followOwner.pendingReview);}
        private void RememberFollow(JObject message){var type=(string)message["type"];if(type=="provider_state")lastProvider=(JObject)message.DeepClone();if(type=="services_state")lastServices=(JObject)message.DeepClone();if(type=="receipt")lastReceipt=(JObject)message.DeepClone();if(new[]{"receipt","sources","artifacts","done","error","disconnected"}.Contains(type)){followMessages.Add((JObject)message.DeepClone());if(followMessages.Count>200)followMessages.RemoveAt(0);}if(followOwner!=null)handoffState=followOwner.HandoffState();}
        private void SendSurface(object value){var message=JObject.FromObject(value);if((string)message["type"]=="artifacts"&&files!=null&&message["data"]?["items"] is JArray items){foreach(JObject item in items){var path=(string)item["previewPath"];if(path==null)continue;try{files.CheckedPath(path,".png",".jpg",".jpeg",".gif",".webp");item["preview"]="https://office-x-assets.local/"+Uri.EscapeDataString(System.IO.Path.GetFileName(path));}catch{}item.Remove("previewPath");}}if((string)message["type"]=="provider_state")lastProvider=(JObject)message.DeepClone();if((string)message["type"]=="services_state")lastServices=(JObject)message.DeepClone();if((string)message["type"]=="receipt")lastReceipt=(JObject)message.DeepClone();surface.Send(message);foreach(var follower in followers.ToArray())if(!follower.IsDisposed){follower.RememberFollow(message);follower.surface.Send(message);}}
        private void RebindActiveDocument(){dynamic window=((dynamic)application).ActiveWindow;int handle=(int)window.HWND;if(System.Runtime.InteropServices.Marshal.IsComObject(window))System.Runtime.InteropServices.Marshal.ReleaseComObject(window);creationPort?.Dispose();creationPort=new DocumentCreationPort(application,app,handle);automationPort?.Dispose();automationPort=new OfficeAutomationPort(application,app,handle);automation=new OfficeAutomationSession(automationPort);createdDuringRun=true;fallbackContext=new{app,documentId=automationPort.DocumentId,targetId="document",document=automationPort.DocumentName,selectionAvailable=false,documentToolsAvailable=true};target.Text=automationPort.DocumentName;try{DocumentWindowChanged?.Invoke(handle);}catch{SendSurface(new{type="document_follow_warning",runId,document=target.Text});}}
        private object RunContext(){var context=JObject.FromObject(Context);context["artifactRoot"]=files.Folder;context["documentTarget"]=documentTarget;return context;}

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hwnd);
        private readonly string root;
        private WorkerProcess worker;
        private ExcelSession session;
        private string runId;
        private CancellationTokenSource cancellation;
        private bool running, nativeBusy;
        private TaskCompletionSource<bool> approval;
        private TaskCompletionSource<JObject> questionAnswer;private string questionId;private JObject pendingQuestion;
        private sealed class PaneText {
            private string text="";
            public event EventHandler TextChanged;
            public string Text {get=>text;set {text=value??"";TextChanged?.Invoke(this,EventArgs.Empty);}}
            public void Clear(){Text="";}
        }
        private readonly PaneText request=new PaneText(),answer=new PaneText(),status=new PaneText(),target=new PaneText(),outcome=new PaneText();
        private readonly ChatSurface surface;
        private string conversationId, reviewId;
        public OfficePane(object application,string root,int windowHandle,string app="excel") {
            this.root=root;this.app=app;this.application=application;this.windowHandle=windowHandle;
            if(app=="excel")port=new ExcelPort((Excel.Application)application,windowHandle);else textPort=new TextPort(application,app,windowHandle);
            surface=new ChatSurface(root);Controls.Add(surface);
            surface.Message+=ReceiveUi;
            surface.Failed+=()=>Cancel();
            status.TextChanged+=(_,__)=>Publish();
            answer.TextChanged+=(_,__)=>Publish();
            outcome.TextChanged+=(_,__)=>Publish();
        }
        private object LaunchCompanion(string path){var executable=Path.Combine(root,"companion","Nubi GenOffice.exe");if(!File.Exists(executable))throw new OfficeFault("companion_unavailable");var start=new System.Diagnostics.ProcessStartInfo(executable){UseShellExecute=false,Arguments=path==null?"":"\""+path+"\"",WorkingDirectory=Path.GetDirectoryName(executable)};using(var process=System.Diagnostics.Process.Start(start)){if(process==null)throw new OfficeFault("companion_start_failed");}return new{status="opened",editor="Nubi GenOffice",sourceCopy=path!=null,currentOfficeChanged=false};}
        private void Publish() {SendSurface(new {type="view",running,runId,conversationId,status=status.Text,text=answer.Text,outcome=outcome.Text,target=target.Text});}
        private async void ReceiveUi(JObject message) {
            try {
                if(followOwner!=null){if(followOwner.running&&new[]{"approve","cancel","choose_target","answer_question"}.Contains((string)message["type"])){followOwner.ReceiveUi(message);return;}if(!followOwner.running)followOwner=null;}
                switch((string)message["type"]) {
                    case "ready":surface.Send(new {type="host",app,version="0.7.0"});EnsureWorker();if(handoffState!=null)ReplayFollow();else Publish();break;
                    case "services":
                        if(running||nativeBusy)throw new OfficeFault("worker_busy");EnsureWorker();worker.Send(new{type="services",id=(string)message["id"],method=(string)message["method"],input=message["input"]});break;
                    case "open_source":
                        if(Uri.TryCreate((string)message["url"],UriKind.Absolute,out var sourceUrl)&&new[]{"https","http"}.Contains(sourceUrl.Scheme)&&string.IsNullOrEmpty(sourceUrl.UserInfo))System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(sourceUrl.AbsoluteUri){UseShellExecute=true});break;
                    case "open_companion":LaunchCompanion(null);break;
                    case "checkpoints":
                        if(files!=null)SendSurface(new{type="checkpoint_list",checkpoints=files.ListCheckpoints()});break;
                    case "rollback":
                        if(running||nativeBusy)throw new OfficeFault("worker_busy");request.Text="문서 복원";conversationId=(string)message["conversationId"];Begin();SendSurface(new{type="started",runId,conversationId,target=target.Text});try{var r=await Native("rollback_document",new JObject{{"checkpointId",message["checkpointId"]}});SendSurface(new{type="done",runId,result=new{text="스냅샷 복원 결과를 확인했습니다."}});}finally{Finish("복원 처리가 끝났습니다.");}break;
                    case "provider":
                        if(running||nativeBusy)throw new OfficeFault("worker_busy");
                        EnsureWorker();worker.Send(new {type="provider",id=(string)message["id"],method=(string)message["method"],input=message["input"]});break;
                    case "inspect":if(!running&&!nativeBusy){CaptureContext();ShowContext();Publish();}break;
                    case "start":
                        if(running||nativeBusy)throw new OfficeFault("worker_busy");
                        handoffState=null;followMessages.Clear();request.Text=(string)message["request"]??"";
                        var cid=(string)message["conversationId"];
                        if(!Guid.TryParse(cid,out var _))throw new OfficeFault("request_invalid");
                        conversationId=cid;documentTarget=(string)message["documentTarget"]=="new"?"new":"current";StartAgent();Publish();break;
                    case "demo":
                        if(running||nativeBusy)throw new OfficeFault("worker_busy");
                        conversationId=(string)message["conversationId"];await Demo();break;
                    case "cancel":Cancel();break;
                    case "answer_question":
                        if((string)message["runId"]==runId&&(string)message["questionId"]==questionId)questionAnswer?.TrySetResult(message["answers"] as JObject??new JObject());break;
                    case "approve":
                        if(running&&(string)message["runId"]==runId&&(string)message["planId"]==reviewId)
                            approval?.TrySetResult((bool?)message["approved"]==true);break;
                    case "clear_conversation":if(!running)worker?.Send(new {type="clear_conversation",conversationId=(string)message["conversationId"]});break;
                }
            }catch(OfficeFault e){SendSurface(new {type="host_error",id=(string)message["id"],operation=(string)message["type"],error=Explain(e.Message),diagnostics=OfficeDiagnostics.Record(e,app,currentStage)});}
            catch(Exception e){SendSurface(new {type="host_error",id=(string)message["id"],operation=(string)message["type"],error=(app=="powerpoint"?"PowerPoint":app=="word"?"Word":"Excel")+" 작업을 준비하지 못했습니다. 오류 정보를 복사해 확인할 수 있습니다.",diagnostics=OfficeDiagnostics.Record(e,app,currentStage)});}
        }
        private void EnsureWorker() {
            if(worker!=null)return;
            currentStage="worker_start";worker=new WorkerProcess(root);var owner=worker;
            worker.Message+=message=>Dispatch(()=>{if(ReferenceEquals(worker,owner))HandleMessage(message);});
            worker.Disconnected+=()=>Dispatch(()=>{
                if(!ReferenceEquals(worker,owner))return;
                worker=null;Finish("Agent 연결이 끊겼습니다. 문서 결과를 확인해 주세요.");
                SendSurface(new {type="disconnected"});owner.Dispose();
            });
            worker.Listen();
        }
        private void CaptureContext(){using(new OfficeCulture()){CaptureContextCore();}}
        private void CaptureContextCore(){
            automationPort?.Dispose();creationPort?.Dispose();
            currentStage="capture_document";automationPort=new OfficeAutomationPort(application,app,windowHandle);automation=new OfficeAutomationSession(automationPort);automationPort.CheckSource();
            creationPort=null;if(files==null)files=new OfficeFiles(application,app,()=>automationPort);surface.SetAssetsRoot(files.Folder);fallbackContext=null;writesStopped=false;createdDuringRun=false;
            currentStage="capture_selection";try{if(app=="excel")session=new ExcelSession(port);else textSession=new TextSession(textPort);}
            catch(OfficeFault e)when(new[]{"select_cells","single_range_required","range_limit","context_limit","select_text","text_block_limit","text_scope_invalid"}.Contains(e.Message)){fallbackContext=new{app,documentId=automationPort.DocumentId,targetId="document",document=automationPort.DocumentName,selectionAvailable=false,selectionReason=e.Message,documentToolsAvailable=true};}
            catch(Exception e){OfficeDiagnostics.Record(e,app,currentStage);fallbackContext=new{app,documentId=automationPort.DocumentId,targetId="document",document=automationPort.DocumentName,selectionAvailable=false,documentToolsAvailable=true};}
        }
        private void ShowContext() {if(fallbackContext!=null){target.Text=automationPort.DocumentName;return;}if(app=="excel"){var c=session.Context; target.Text=c.Workbook+" / "+c.Worksheet+" / "+c.Address;}else{var c=textSession.Context;target.Text=c.Document+" / "+c.Location;}}
        private void Begin() {
            if(running||nativeBusy)throw new OfficeFault("worker_busy");
            CaptureContext();ShowContext();runId=Guid.NewGuid().ToString("N");
            cancellation=new CancellationTokenSource();
            lastReceipt=null;running=true;SetBusy(true);answer.Clear();outcome.Text="아직 문서 변경을 검증하지 않았습니다.";
        }
        private void SetBusy(bool busy) {Publish();}
        private void StartAgent() {
            if(string.IsNullOrWhiteSpace(request.Text)||request.Text.Length>8000)throw new OfficeFault("request_invalid");
            EnsureWorker();
            Begin();
            try {currentStage="dispatch_request";worker.Send(new {type="start",runId,request=request.Text,context=RunContext(),conversationId});
                SendSurface(new {type="started",runId,conversationId,target=target.Text});
                status.Text="문서를 확인하고 작업을 계획합니다.";}
            catch {Finish("Agent 요청을 전달하지 못했습니다.");throw;}
        }
        private void Dispatch(Action action) {
            if(IsDisposed||!IsHandleCreated)return;
            try {BeginInvoke(new Action(()=>{if(!IsDisposed)action();}));}catch(InvalidOperationException){}
        }
        private async void HandleMessage(JObject message) {
            var type=(string)message["type"];
            if(type=="vault_write") {
                bool ok=false;try{ProtectedVault.Write((string)message["key"],message["value"]);ok=true;}catch{}
                worker?.Send(new {type="vault_result",id=(string)message["id"],ok});return;
            }
            if(type=="ready") {
                var records=new JArray();string selected=null;
                try {foreach(var name in new[]{"aipro","chatgpt","fabrix","claude"}){var record=ProtectedVault.Read("provider:"+name);if(record!=null)records.Add(record);}selected=(string)ProtectedVault.Read("provider:active");}
                catch {SendSurface(new {type="host_error",error="보관한 연결을 읽지 못했습니다. 다시 로그인해 주세요."});}
                worker?.Send(new {type="init",records,selected,services=ProtectedVault.Read("services")});return;
            }
            if(type=="provider_state"||type=="services_state"){if(followOwner==null)SendSurface(message);return;}if(type=="reply"){surface.Send(message);return;}
            if((string)message["runId"]!=runId||!running)return;
            SendSurface(message);
            switch((string)message["type"]) {
                case "text": answer.Text=((string)message["data"]??"");break;
                case "tool":
                    if(message["id"]==null){status.Text="문서 도구를 실행하고 있습니다.";break;}
                    var id=(string)message["id"];var currentRun=runId; object result;
                    if(nativeBusy) result=new {ok=false,error="native_busy"};
                    else {
                        nativeBusy=true;
                        try {currentStage="native_"+(string)message["name"];result=await Native((string)message["name"],message["input"] as JObject??new JObject());}
                        catch(OfficeFault e){OfficeDiagnostics.Record(e,app,currentStage);result=new {ok=false,error=e.Message,failedMember=e.Member,nativeCode=e.NativeCode,invocationStarted=e.InvocationStarted,recovery=e.InvocationStarted==false?"No call was made. Use inspect_office_members and the native guide; root document is not Application. Use dedicated file tools for Save/Open/Export.":null};status.Text=Explain(e.Message);}
                        catch(OperationCanceledException){result=new {ok=false,status="cancelled"};}
                        catch{result=new {ok=false,error="native_execution_failed"};}
                        finally {nativeBusy=false;if(!running)SetBusy(false);}
                    }
                    try {worker?.Send(new {type="tool_result",runId=currentRun,id,result});}catch{Cancel();Finish("문서 실행 결과 전달 실패. 변경 내역을 확인해 주세요.");}
                    break;
                case "done":
                    answer.Text=(string)message["result"]?["text"]??answer.Text;
                    Finish((bool?)message["result"]?["cancelled"]==true?"중지되었습니다. 이미 적용한 변경은 유지됩니다.":
                        (bool?)message["result"]?["turnLimit"]==true?"실행 한도에 도달했습니다. 완료 여부를 확인해 주세요.":"Agent 응답이 끝났습니다. 문서 검증 결과를 확인하세요.");break;
                case "error": Finish("Agent 실행을 완료하지 못했습니다. 연결 설정과 문서 결과를 확인해 주세요.");break;
            }
        }
        private async Task<object> Native(string name,JObject input) {using(new OfficeCulture()){return await NativeCore(name,input);}}
        private async Task<object> NativeCore(string name,JObject input) {
            var current=session;var cancelToken=cancellation.Token;
            cancelToken.ThrowIfCancellationRequested();
            if(writesStopped&&name!="list_checkpoints"&&name!="rollback_document"&&name!="render_slides"&&name!="export_document_copy"&&name!="export_document_pdf"&&name!="inspect_office"&&name!="inspect_office_members"&&name!="read_selection"&&name!="read_outline"&&name!="read_range"&&name!="read_sheet_context"&&name!="read_surrounding")throw new OfficeFault("writes_stopped_for_this_run");
            if(name=="ask_clarification"){
                var questions=input["questions"] as JArray;if(questions==null||questions.Count<1||questions.Count>3||questions.Any(q=>q["question"]?.Type!=JTokenType.String||((string)q["question"]).Length>500||q["options"] is JArray opts&&opts.Count>6))throw new OfficeFault("question_invalid");
                questionId=Guid.NewGuid().ToString("N");questionAnswer=new TaskCompletionSource<JObject>(TaskCreationOptions.RunContinuationsAsynchronously);pendingQuestion=JObject.FromObject(new{type="question",runId,questionId,questions});SendSurface(pendingQuestion);
                using(cancelToken.Register(()=>questionAnswer?.TrySetCanceled()))try{var answers=await questionAnswer.Task;return new{answers};}finally{questionAnswer=null;questionId=null;pendingQuestion=null;SendSurface(new{type="question_closed",runId});}
            }
            if(name=="list_checkpoints")return files.ListCheckpoints();
            if(name=="checkpoint_document")return files.CheckpointNow((string)input["label"]);
            if(name=="open_genoffice_editor")return LaunchCompanion(files.CheckedPath((string)input["path"],".docx",".docm",".xlsx",".xlsm",".pptx",".pptm",".pdf",".html",".htm",".md",".markdown",".txt",".csv"));
            if(name=="export_document_copy")return files.ExportCopy();
            if(name=="export_document_pdf")return files.ExportPdf(cancelToken);
            if(name=="select_input_file")return files.SelectInput();
            if(name=="render_slides")return files.RenderSlides((int?)input["first"]??1,(int?)input["count"]??6,(int?)input["width"]??1280,cancelToken);
            if(name=="save_artifact")return files.SaveArtifact((string)input["path"],(string)input["name"]);
            if(new[]{"rollback_document","import_slides","open_artifact","insert_image","import_word_content"}.Contains(name)){
                var planId=Guid.NewGuid().ToString("N");string summary=name=="rollback_document"?"문서 전체 스냅샷을 새 창에 복원합니다. 현재 문서는 그대로 유지됩니다.":(string)input["summary"]??"문서에 변경을 적용합니다.";
                if(!await AwaitReview(planId,new{kind="file_operation",summary,name})){writesStopped=true;return new{status="rejected",mutated=false};}
                object receipt;
                if(name=="rollback_document")receipt=files.Restore((string)input["checkpointId"],cancelToken);
                else if(name=="open_artifact")receipt=files.OpenArtifact((string)input["path"],(string)input["sourceState"],cancelToken);
                else if(name=="import_slides")receipt=files.ImportSlides((string)input["path"],(string)input["mode"]??"new",(int?)input["slide"]??0,(string)input["sourceState"],cancelToken);
                else if(name=="import_word_content")receipt=files.ImportWordContent((string)input["path"],(string)input["expectedTextHash"],cancelToken);else receipt=files.InsertImage((string)input["path"],input,cancelToken);
                var r=JObject.FromObject(receipt);
                if((bool?)r["mutated"]==true&&(name=="rollback_document"||name=="open_artifact"||name=="import_slides"&&(string)input["mode"]=="new")){try{RebindActiveDocument();}catch{r["status"]="partial";r["error"]="created_document_binding_failed";r["followUpAvailable"]=false;}}
                if((string)r["status"]=="verified"&&name=="import_slides"&&input["expectedTextHashes"] is JArray expected){
                    var actual=JArray.FromObject(files.ReadSlideText());int offset=(string)input["mode"]=="append"?actual.Count-expected.Count:(string)input["mode"]=="regenerate"?(int?)input["slide"]??0:0;
                    string Clean(string text)=>System.Text.RegularExpressions.Regex.Replace(text??"",@"\s+"," ").Trim();
                    bool matches=offset>=0&&actual.Count>=offset+expected.Count;
                    for(int i=0;matches&&i<expected.Count;i++){var right=((JArray)actual[offset+i]["texts"]).Select(x=>Clean((string)x)).Where(x=>x.Length>0).ToArray();matches=String.Equals(Wire.Hash(right),(string)expected[i],StringComparison.OrdinalIgnoreCase);}
                    if(!matches){r["status"]="partial";r["error"]="slide_text_readback_mismatch";}else r["contentVerified"]=true;
                }
                lastReceipt=null;SendSurface(new{type="receipt",runId,receipt=r});writesStopped=(string)r["status"]!="verified";return r;
            }
            if(name=="save_document"){var saved=automationPort.Save((string)input["format"]=="pdf",cancelToken);SendSurface(new{type="receipt",runId,receipt=saved});return saved;}
            if(name=="inspect_office_members")return automationPort.Members((string)input["target"],(string)input["query"],(int?)input["count"]??80);
            if(name=="inspect_office")return automation.Inspect(input["steps"]?.ToObject<List<OfficeStep>>());
            if(writesStopped&&new[]{"create_document","execute_office_operations","replace_blocks","replace_text","set_formula"}.Contains(name))throw new OfficeFault("writes_stopped_for_this_run");
            if(name=="execute_office_operations"){
                var plan=automation.Prepare((string)input["snapshotId"],(string)input["summary"],input["steps"]?.ToObject<List<OfficeStep>>(),input["checks"]?.ToObject<List<OfficeCheck>>());
                status.Text="문서 변경안을 확인해 주세요.";
                var approved=await AwaitReview(plan.Id,plan);if(approved)files.CheckpointNow(plan.Summary);var receipt=await automation.ApplyAsync(plan.Id,approved,cancelToken);
                writesStopped=receipt.Status!="verified"&&!OfficeCallPolicy.CanReplan(receipt);SendSurface(new{type="receipt",runId,receipt});outcome.Text=receipt.Status=="verified"?"문서 변경과 결과를 확인했습니다. 저장 전입니다.":"변경 결과: "+receipt.Status;return receipt;
            }
            if(name=="create_document"){
                if(documentTarget!="new")throw new OfficeFault("target_current_use_office_operations");
                if(creationPort==null)creationPort=new DocumentCreationPort(application,app,windowHandle);var creation=new DocumentCreation(creationPort,app,input.ToObject<DocumentDraft>());var plan=creation.Plan;
                status.Text="새 문서 내용을 확인해 주세요.";var approved=await AwaitReview(plan.Id,plan);var receipt=creation.Apply(plan.Id,approved,cancelToken);
                writesStopped=receipt.Status!="verified";
                SendSurface(new{type="receipt",runId,receipt});
                if(receipt.Status=="verified"){
                    try{creationPort.ActivateCreated();RebindActiveDocument();}
                    catch{outcome.Text="새 문서는 만들어졌지만 후속 연결을 확인해야 합니다.";return new{status="verified",mutated=true,document=receipt.Document,followUpAvailable=false,error="created_document_binding_failed"};}
                }
                outcome.Text=receipt.Status=="verified"?"새 문서를 만들고 내용을 확인했습니다. 저장 전입니다.":"생성 결과: "+receipt.Status;return receipt;
            }
            if(fallbackContext!=null)throw new OfficeFault("use_document_tools");
            if(app!="excel") {
                if(name=="read_selection")return textSession.Read();
                if(name=="read_outline")return textPort.ReadOutline();
                if(name!="replace_text"&&name!="replace_blocks")throw new OfficeFault("unsupported_tool");
                var textPlan=name=="replace_blocks"?textSession.PrepareBlocks((string)input["snapshotId"],input["operations"]?.ToObject<List<TextOperation>>()):textSession.Prepare((string)input["snapshotId"],(string)input["text"]);
                var accepted=await ReviewText(textPlan);if(accepted)files.CheckpointNow("문장 변경 전");
                var textReceipt=textSession.Apply(textPlan.Id,accepted,cancelToken);writesStopped=textReceipt.Status!="verified";
                SendSurface(new {type="receipt",runId,receipt=textReceipt});
                outcome.Text=textReceipt.Status=="verified"?"문장 변경을 확인했습니다. 저장 전입니다.":"변경 결과: "+textReceipt.Status;
                return textReceipt;
            }
            switch(name) {
                case "read_selection":return current.ReadSelection();
                case "read_sheet_context":return current.ReadContext();
                case "read_surrounding":return current.ReadSurrounding();
                case "read_range":return current.ReadRange((string)input["address"]);
                case "calculate_and_read":return current.CalculateAndRead();
                case "set_formula":
                    var plan=current.Prepare((string)input["snapshotId"],input["operations"]?.ToObject<List<FormulaOperation>>());
                    var approved=await Review(plan);if(approved)files.CheckpointNow("수식 변경 전");
                    var receipt=current.Apply(plan.Id,approved,cancelToken); ShowReceipt(receipt); return receipt;
                default:throw new OfficeFault("unsupported_tool");
            }
        }
        private Task<bool> ReviewText(TextPlan plan){status.Text="변경 전후를 확인해 주세요.";return AwaitReview(plan.Id,plan);}
        private Task<bool> Review(ChangePlan plan) {
            status.Text="빈 셀 "+plan.Operations.Count+"개의 변경안을 확인해 주세요.";
            return AwaitReview(plan.Id,plan);
        }
        private async Task<bool> AwaitReview(string id,object plan) {
            if(createdDuringRun&&followers.Count==0)SetForegroundWindow(new IntPtr(windowHandle));
            reviewId=id;
            pendingReview=JObject.FromObject(new {type="review",runId,planId=id,plan,target=target.Text});SendSurface(pendingReview);
            approval=new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            using(cancellation.Token.Register(()=>approval?.TrySetResult(false))) {
                try{var accepted=await approval.Task;if(accepted&&createdDuringRun)automationPort.FocusSource();return accepted;}finally{approval=null;reviewId=null;pendingReview=null;SendSurface(new {type="review_closed"});}
            }
        }
        private void ShowReceipt(ApplyReceipt receipt) {
            SendSurface(new {type="receipt",runId,receipt});
            var verified=receipt.Cells.Count(c=>c.Status=="verified");
            outcome.Text=(receipt.Status=="verified"?"수식과 계산값 확인: "+verified+"개":
                "확인 필요: "+receipt.Status+" / "+Explain(receipt.Error)) + "\r\n저장하지 않았습니다.";
            if(receipt.Cells.Count>0) outcome.Text+="\r\n"+string.Join("\r\n",receipt.Cells.Take(6).Select(c=>c.Address+": "+c.Formula+" → "+Convert.ToString(c.ActualValue)+" ("+c.Status+")"));
        }
        private async Task Demo() {
            Begin();SendSurface(new {type="started",runId,conversationId,target=target.Text});
            try {
                if(app!="excel"){
                    var selected=textSession.Read();answer.Text=selected.Text;
                    SendSurface(new {type="done",runId,result=new {text=selected.Text,cancelled=false}});
                    Finish("선택한 텍스트를 읽었습니다. 모델에 전송하지 않았습니다.");return;
                }
                var snapshot=session.ReadSelection();
                if(snapshot.Address!="C1:E4")throw new OfficeFault("demo_scope");
                var plan=session.Prepare(snapshot.SnapshotId,Enumerable.Range(2,3).Select(r=>new FormulaOperation{Address="E"+r,Formula="=C"+r+"*D"+r}).ToList());
                var approved=await Review(plan);ShowReceipt(session.Apply(plan.Id,approved,cancellation.Token));
                SendSurface(new {type="done",runId,result=new {text=outcome.Text,cancelled=cancellation.IsCancellationRequested}});
                Finish("문서 도구 확인이 끝났습니다. 모델에 전송하지 않았습니다.");
            }catch(OfficeFault e){SendSurface(new {type="error",runId});Finish(Explain(e.Message));}
            catch{SendSurface(new {type="error",runId});Finish("문서 도구 확인에 실패했습니다. 변경 내역을 확인해 주세요.");}
        }
        private void Cancel() {
            cancellation?.Cancel();approval?.TrySetResult(false);questionAnswer?.TrySetCanceled();
            if(running)try{worker?.Send(new {type="cancel",runId});}catch{}
            status.Text="중지 요청됨. 이미 적용한 변경은 자동 복구하지 않습니다.";
        }
        private void Finish(string text) {running=false;status.Text=text;foreach(var follower in followers.ToArray())if(!follower.IsDisposed){follower.handoffState=HandoffState();follower.followOwner=null;follower.files=files?.Fork(()=>follower.automationPort);follower.EnsureWorker();}followers.Clear();cancellation?.Cancel();SetBusy(nativeBusy);approval?.TrySetResult(false);}
        private static string Explain(string code) {
            if(code=="companion_unavailable")return "별도 편집기를 설치한 뒤 다시 열어주세요.";
            if(code=="companion_start_failed")return "편집기를 열지 못했습니다. 설치 상태를 확인해주세요.";
            switch(code) {
                case "open_document_required":return "작업할 문서를 먼저 열어 주세요.";
                case "office_member_unavailable":case "office_member_not_found":return "이 문서의 지원 멤버를 다시 확인하고 작업 방법을 조정합니다.";
                case "write_out_of_scope":return "읽기는 주변 범위까지 가능합니다. 수정할 셀은 선택한 뒤 다시 요청해 주세요.";
                case "source_changed":return "문서가 변경됐습니다. 범위를 다시 확인해 주세요.";
                case "document_closed":return "대상 문서 또는 시트가 닫혔습니다.";
                case "target_not_empty":case "target_changed":return "금액 셀에 기존 내용이 있습니다. 덮어쓰지 않았습니다.";
                case "unsupported_range":return "병합 셀, 표, 배열 수식, 숨긴 행과 열은 아직 지원하지 않습니다.";
                case "range_limit":return "101행, 20열 이내의 범위를 선택해 주세요.";
                case "context_limit":return "선택한 셀의 내용이 많습니다. 더 작은 범위를 선택해 주세요.";
                case "select_cells":case "single_range_required":return "한 개의 연속된 표 범위를 선택해 주세요.";
                case "provider_missing":return "모델 서버 주소와 모델 ID를 입력해 주세요.";
                case "node_runtime_missing":return "Node.js 22.19 이상이 필요합니다. Windows 실행 안내를 확인해 주세요.";
                case "worker_missing":return "Agent 실행 파일이 없습니다. Build-Windows.ps1을 실행해 주세요.";
                case "demo_scope":return "도구 확인은 C1:E4를 선택해 주세요. C열 수량, D열 단가, E열 빈 금액입니다.";
                case "numeric_source_required":return "수량과 단가에 숫자가 필요합니다.";
                case "activate_source_window":return "이 작업창이 붙어 있는 문서 창을 활성화해 주세요.";
                case "select_text":return "문단이나 텍스트 상자를 선택해 주세요.";
                case "text_block_limit":return "문단 30개 이내로 선택해 주세요.";
                case "text_scope_invalid":return "8,000자 이내의 문장을 선택해 주세요.";
                case "text_format_unsupported":return "문서 개체 도구로 서식과 구조를 확인하고 있습니다.";
                case "use_document_tools":return "문서 전체에서 작업할 위치를 찾고 있습니다.";
                case "single_paragraph_required":return "문단 나눔 없는 문장만 적용할 수 있습니다.";
                case null:return "문서 상태를 확인해 주세요.";
                default:return "작업을 진행하지 못했습니다: "+code;
            }
        }
        protected override void Dispose(bool disposing) {
            if(disposing){automationPort?.Dispose();creationPort?.Dispose();cancellation?.Cancel();approval?.TrySetResult(false);questionAnswer?.TrySetCanceled();worker?.Dispose();worker=null;port?.Dispose();textPort?.Dispose();surface.Dispose();}
            base.Dispose(disposing);
        }
    }
}
