using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Drawing;
using System.Runtime.InteropServices;
using Newtonsoft.Json.Linq;
using Microsoft.Web.WebView2.WinForms;
using OfficeX.Core;
using OfficeX.ExcelHost;
class Program {
 static ChatSurface surface;static Form form;static JObject packet;static bool testing,inputVerified;static int approvals;static string failure;static JArray packets;static TaskCompletionSource<bool> reloaded;
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")]static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 [STAThread]static int Main(string[] args){
  packets=JArray.Parse(File.ReadAllText("verification/native-wire.json"));form=new Form{Width=420,Height=800,Text="Native WebView2 regression"};surface=new ChatSurface(args[0]);form.Controls.Add(surface);
  surface.Message+=m=>{if((string)m["type"]=="ready"){surface.Send(new{type="provider_state",state=new{provider="claude",connected=true,initializing=false,model="sonnet",models=new[]{new{id="sonnet",label="Sonnet"}}}});if(reloaded!=null){Replay();reloaded.TrySetResult(true);}}
   if((string)m["type"]=="approve"){approvals++;surface.Send(new{type="review_closed"});surface.Send(packet["receipt"]);surface.Send(new{type="done",runId="native-run",result=new{text="생성을 확인했습니다."}});}
   if((string)m["type"]=="ui_rendered"&&!testing){testing=true;Run();}};
  var timeout=new Timer{Interval=90000};timeout.Tick+=(_,__)=>{failure="Native WebView2 test timed out";form.Close();};timeout.Start();Application.Run(form);timeout.Dispose();
  var result=new{passed=failure==null,scope="installed VSTO UI in real Windows WinForms WebView2 with actual C# packets and Windows mouse/keyboard input; Office COM and live LLM not tested",editors=3,approvals,physicalClickAndTyping=inputVerified,invalidContractRecovery=failure==null,error=failure};File.WriteAllText("verification/native-surface.json",Wire.Json(result));Console.WriteLine(Wire.Json(result));return failure==null?0:1;
 }
 static WebView2 Web()=>surface.Controls.OfType<WebView2>().Single();
 static void Replay(){surface.Send(new{type="host",app=(string)packet["app"],version="0.8.9"});surface.Send(new{type="handoff",app=(string)packet["app"],conversationId="native-session",runId="native-run",request="새 문서 만들기",text="",running=true});surface.Send(packet["review"]);}
 static async Task Wait(string js){for(int i=0;i<150;i++){if((await Web().CoreWebView2.ExecuteScriptAsync(js))=="true")return;await Task.Delay(100);}throw new Exception("Native UI condition failed");}
 static async Task Click(string selector){var raw=await Web().CoreWebView2.ExecuteScriptAsync("(()=>{const e=document.querySelector("+Wire.Json(selector)+");if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");var point=JObject.Parse(raw);var screen=Web().PointToScreen(new Point((int)(double)point["x"],(int)(double)point["y"]));form.Activate();SetForegroundWindow(form.Handle);SetCursorPos(screen.X,screen.Y);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);await Task.Delay(150);}
 static async Task Input(){if(surface.Controls.OfType<Panel>().Single().Visible)throw new Exception("Recovery layer intercepts mouse input");await Click("[aria-label='연결 설정']");await Wait("document.body.innerText.includes('모델 선택')");await Click(".cx-panel-header-actions [data-action='close']");await Wait("!document.body.innerText.includes('모델 선택')");await Click("textarea");await Wait("document.activeElement.tagName==='TEXTAREA'");SendKeys.SendWait("nubi input 2016");await Wait("document.querySelector('textarea').value.includes('nubi input 2016')");inputVerified=true;}
 static async void Run(){try{
   foreach(JObject item in packets){packet=item;Replay();await Wait("document.body.innerText.includes('새 문서를 만들까요?')");await Input();await Web().CoreWebView2.ExecuteScriptAsync("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='변경 적용').click()");await Wait("document.body.innerText.includes('새 문서 생성 확인') && document.body.innerText.includes('생성을 확인했습니다.')");}
   if(approvals!=3)throw new Exception("Approval count mismatch");Replay();await Wait("document.body.innerText.includes('새 문서를 만들까요?')");surface.Send(JObject.Parse("{\"type\":\"review\",\"runId\":\"native-run\",\"plan\":{\"Kind\":\"create_document\",\"Content\":{}}}"));await Task.Delay(500);
   if(surface.IsReady)throw new Exception("UI failure was not caught by the native recovery surface");
   reloaded=new TaskCompletionSource<bool>();var retry=surface.Controls.OfType<Panel>().Single().Controls.OfType<Button>().Single();if(!retry.Visible)throw new Exception("Native retry button missing");retry.PerformClick();await reloaded.Task;await Wait("document.body.innerText.includes('새 문서를 만들까요?')");await Input();if(approvals!=3)throw new Exception("Screen recovery replayed a write");
  }catch(Exception e){failure=e.GetType().Name+": "+e.Message;}finally{form.Close();}}
}
