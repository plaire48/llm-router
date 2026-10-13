using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;
using Microsoft.Web.WebView2.WinForms;
using OfficeX.Core;
using OfficeX.ExcelHost;
class Program {
 static ChatSurface surface;static Form form;static JObject packet;static bool testing;static int approvals;static string failure;static JArray packets;static TaskCompletionSource<bool> reloaded;
 [STAThread]static int Main(string[] args){
  packets=JArray.Parse(File.ReadAllText("verification/native-wire.json"));form=new Form{Width=420,Height=800,Text="Native WebView2 regression"};surface=new ChatSurface(args[0]);form.Controls.Add(surface);
  surface.Message+=m=>{if((string)m["type"]=="ready"){surface.Send(new{type="provider_state",state=new{provider="claude",connected=true,initializing=false,model="sonnet",models=new[]{new{id="sonnet",label="Sonnet"}}}});if(reloaded!=null){Replay();reloaded.TrySetResult(true);}}
   if((string)m["type"]=="approve"){approvals++;surface.Send(new{type="review_closed"});surface.Send(packet["receipt"]);surface.Send(new{type="done",runId="native-run",result=new{text="생성을 확인했습니다."}});}
   if((string)m["type"]=="ui_rendered"&&!testing){testing=true;Run();}};
  var timeout=new Timer{Interval=90000};timeout.Tick+=(_,__)=>{failure="Native WebView2 test timed out";form.Close();};timeout.Start();Application.Run(form);timeout.Dispose();
  var result=new{passed=failure==null,scope="installed VSTO UI in real Windows WinForms WebView2 with actual C# packets; Office COM and live LLM not tested",editors=3,approvals,invalidContractRecovery=failure==null,error=failure};File.WriteAllText("verification/native-surface.json",Wire.Json(result));Console.WriteLine(Wire.Json(result));return failure==null?0:1;
 }
 static WebView2 Web()=>surface.Controls.OfType<WebView2>().Single();
 static void Replay(){surface.Send(new{type="host",app=(string)packet["app"],version="0.7.1"});surface.Send(new{type="handoff",app=(string)packet["app"],conversationId="native-session",runId="native-run",request="새 문서 만들기",text="",running=true});surface.Send(packet["review"]);}
 static async Task Wait(string js){for(int i=0;i<150;i++){if((await Web().CoreWebView2.ExecuteScriptAsync(js))=="true")return;await Task.Delay(100);}throw new Exception("Native UI condition failed");}
 static async void Run(){try{
   foreach(JObject item in packets){packet=item;Replay();await Wait("document.body.innerText.includes('새 문서를 만들까요?')");await Web().CoreWebView2.ExecuteScriptAsync("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='변경 적용').click()");await Wait("document.body.innerText.includes('새 문서 생성 확인') && document.body.innerText.includes('생성을 확인했습니다.')");}
   if(approvals!=3)throw new Exception("Approval count mismatch");Replay();await Wait("document.body.innerText.includes('새 문서를 만들까요?')");surface.Send(JObject.Parse("{\"type\":\"review\",\"runId\":\"native-run\",\"plan\":{\"Kind\":\"create_document\",\"Content\":{}}}"));await Task.Delay(500);
   if(surface.IsReady)throw new Exception("UI failure was not caught by the native recovery surface");
   reloaded=new TaskCompletionSource<bool>();var retry=surface.Controls.OfType<Panel>().Single().Controls.OfType<Button>().Single();if(!retry.Visible)throw new Exception("Native retry button missing");retry.PerformClick();await reloaded.Task;await Wait("document.body.innerText.includes('새 문서를 만들까요?')");if(approvals!=3)throw new Exception("Screen recovery replayed a write");
  }catch(Exception e){failure=e.GetType().Name+": "+e.Message;}finally{form.Close();}}
}
