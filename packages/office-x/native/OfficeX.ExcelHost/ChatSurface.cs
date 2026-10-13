using System;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Newtonsoft.Json.Linq;
using OfficeX.Core;
namespace OfficeX.ExcelHost
{
    internal sealed class ChatSurface : UserControl
    {
        private const string Origin="https://office-x.local";
        private readonly WebView2 web=new WebView2 {Dock=DockStyle.Fill};
        private bool ready;
        private string assetsRoot;
        public void SetAssetsRoot(string path){assetsRoot=path;if(web.CoreWebView2!=null)web.CoreWebView2.SetVirtualHostNameToFolderMapping("office-x-assets.local",path,CoreWebView2HostResourceAccessKind.DenyCors);}
        public event Action<JObject> Message;
        public event Action Failed;
        public ChatSurface(string root) {
            Dock=DockStyle.Fill;Controls.Add(web);
            Load+=async (_,__)=>{
                try {
                    string ui=Path.Combine(root,"ui");if(!File.Exists(Path.Combine(ui,"index.html")))throw new IOException();
                    var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"OfficeX","WebView2"));
                    await web.EnsureCoreWebView2Async(env);
                    var core=web.CoreWebView2;
                    core.Settings.AreDevToolsEnabled=false;core.Settings.AreHostObjectsAllowed=false;
                    core.Settings.IsGeneralAutofillEnabled=false;core.Settings.IsPasswordAutosaveEnabled=false;
                    core.Settings.AreDefaultContextMenusEnabled=false;
                    core.SetVirtualHostNameToFolderMapping("office-x.local",ui,CoreWebView2HostResourceAccessKind.DenyCors);
                    if(assetsRoot!=null)core.SetVirtualHostNameToFolderMapping("office-x-assets.local",assetsRoot,CoreWebView2HostResourceAccessKind.DenyCors);
                    core.NavigationStarting+=(_,e)=>{if(e.Uri!=Origin+"/index.html")e.Cancel=true;};
                    core.NewWindowRequested+=(_,e)=>e.Handled=true;
                    core.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;
                    core.DownloadStarting+=(_,e)=>e.Cancel=true;
                    core.WebMessageReceived+=(_,e)=>{
                        if(e.Source!=Origin+"/index.html"||e.WebMessageAsJson.Length>128*1024)return;
                        try {var m=JObject.Parse(e.WebMessageAsJson);if((string)m["type"]=="ready")ready=true;Message?.Invoke(m);}catch{Failed?.Invoke();}
                    };
                    core.Navigate(Origin+"/index.html");
                }catch {Controls.Clear();Controls.Add(new Label {Dock=DockStyle.Fill,Text="채팅창을 열지 못했습니다. WebView2 Runtime과 Office X 설치 파일을 확인해 주세요.",Padding=new Padding(16)});Failed?.Invoke();}
            };
        }
        public void Send(object value){if(ready&&!IsDisposed&&web.CoreWebView2!=null)web.CoreWebView2.PostWebMessageAsJson(Wire.Json(value));}
        protected override void Dispose(bool disposing){if(disposing)web.Dispose();base.Dispose(disposing);}
    }
}
