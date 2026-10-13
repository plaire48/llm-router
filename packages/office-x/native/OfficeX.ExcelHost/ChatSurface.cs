using System;
using System.IO;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Newtonsoft.Json.Linq;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 internal sealed class ChatSurface:UserControl {
  const string Origin="https://office-x.local";
  WebView2 web;bool ready,initializing,initialized;string assetsRoot;readonly string root;
  readonly Panel recovery=new Panel{Dock=DockStyle.Fill,BackColor=Color.FromArgb(248,250,252),Padding=new Padding(24)};
  readonly Label notice=new Label{Dock=DockStyle.Top,AutoSize=false,Height=96,Text="누비 Agent를 여는 중입니다.\r\n문서와 대화를 연결하고 있습니다."};
  readonly Button retry=new Button{Dock=DockStyle.Top,Height=36,Text="화면 다시 열기",Visible=false};
  readonly Timer loading=new Timer{Interval=30000};
  public bool IsReady=>ready;
  public event Action<JObject> Message;public event Action Failed;
  public ChatSurface(string root){this.root=root;Dock=DockStyle.Fill;recovery.Controls.Add(retry);recovery.Controls.Add(notice);Controls.Add(recovery);AddWeb();Load+=async(_,__)=>{if(!initialized&&!initializing)await Initialize();};retry.Click+=async(_,__)=>{ready=false;initialized=false;web.Dispose();Controls.Remove(web);AddWeb();await Initialize();};loading.Tick+=(_,__)=>ShowFailure();}
  void AddWeb(){web=new WebView2{Dock=DockStyle.Fill,TabStop=true,DefaultBackgroundColor=Color.FromArgb(248,250,252)};Controls.Add(web);recovery.BringToFront();}
  protected override void OnEnter(EventArgs e){base.OnEnter(e);if(ready&&!web.IsDisposed)web.Focus();}
  void ShowFailure(){if(IsDisposed)return;ready=false;loading.Stop();notice.Text="Agent 화면을 다시 열어주세요.\r\n진행한 문서 변경은 유지됩니다.";retry.Visible=true;recovery.Visible=true;recovery.BringToFront();Failed?.Invoke();}
  public void SetAssetsRoot(string path){assetsRoot=path;if(web.CoreWebView2!=null)web.CoreWebView2.SetVirtualHostNameToFolderMapping("office-x-assets.local",path,CoreWebView2HostResourceAccessKind.DenyCors);}
  async Task Initialize(){if(IsDisposed||initializing)return;initializing=true;recovery.Visible=true;retry.Visible=false;notice.Text="누비 Agent를 여는 중입니다.\r\n문서와 대화를 연결하고 있습니다.";loading.Start();var current=web;
   try{
    string ui=Path.Combine(root,"ui");if(!File.Exists(Path.Combine(ui,"index.html")))throw new IOException();
    var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"OfficeX","WebView2"));if(IsDisposed||current.IsDisposed)return;
    await current.EnsureCoreWebView2Async(env);if(IsDisposed||current.IsDisposed)return;var core=current.CoreWebView2;
    core.Settings.AreDevToolsEnabled=false;core.Settings.AreHostObjectsAllowed=false;core.Settings.IsGeneralAutofillEnabled=false;core.Settings.IsPasswordAutosaveEnabled=false;core.Settings.AreDefaultContextMenusEnabled=false;
    core.SetVirtualHostNameToFolderMapping("office-x.local",ui,CoreWebView2HostResourceAccessKind.DenyCors);if(assetsRoot!=null)core.SetVirtualHostNameToFolderMapping("office-x-assets.local",assetsRoot,CoreWebView2HostResourceAccessKind.DenyCors);
    core.NavigationStarting+=(_,e)=>{if(e.Uri!=Origin+"/index.html")e.Cancel=true;else ready=false;};
    core.NavigationCompleted+=(_,e)=>{if(!e.IsSuccess)ShowFailure();};core.ProcessFailed+=(_,e)=>ShowFailure();
    core.NewWindowRequested+=(_,e)=>e.Handled=true;core.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;core.DownloadStarting+=(_,e)=>e.Cancel=true;
    core.WebMessageReceived+=(_,e)=>{
     if(e.Source!=Origin+"/index.html"||e.WebMessageAsJson.Length>128*1024)return;
     JObject m;try{m=JObject.Parse(e.WebMessageAsJson);}catch{return;}
     var type=(string)m["type"];if(type=="ready")ready=true;
     if(type=="ui_rendered"){if(!ready)return;loading.Stop();recovery.Visible=false;web.BringToFront();}
     if(type=="ui_fault")ShowFailure();
     // Host/provider errors belong to the chat. They must not cover a rendered, interactive screen.
     try{Message?.Invoke(m);}catch(Exception fault){OfficeDiagnostics.Record(fault,"office","chat_message");}
    };
    initialized=true;core.Navigate(Origin+"/index.html");
   }catch{ShowFailure();}finally{initializing=false;}
  }
  public void Send(object value){if(!ready||IsDisposed||web.CoreWebView2==null)return;try{web.CoreWebView2.PostWebMessageAsJson(Wire.Json(value));}catch{ShowFailure();}}
  protected override void Dispose(bool disposing){if(disposing){loading.Dispose();web.Dispose();}base.Dispose(disposing);}
 }
}
