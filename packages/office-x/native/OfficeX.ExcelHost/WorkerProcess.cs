using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using OfficeX.Core;

namespace OfficeX.ExcelHost
{
    // Adapted from Nubi's stdio worker. No shell or local HTTP listener.
    internal sealed class WorkerProcess : IDisposable
    {
        private readonly Process process;
        private readonly StreamWriter input;
        private readonly object gate=new object();
        private bool disposed;
        public event Action<JObject> Message;
        public event Action Disconnected;
        public WorkerProcess(string root) {
            var bundled=Path.Combine(root,"runtime","node.exe");
            var installed=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"nodejs","node.exe");
            var runtime=File.Exists(bundled) ? bundled : installed;
            if(!File.Exists(runtime)) throw new OfficeFault("node_runtime_missing");
            var entry=Path.Combine(root,"worker","main.cjs");
            if(!File.Exists(entry)) throw new OfficeFault("worker_missing");
            process=new Process {StartInfo=new ProcessStartInfo(runtime,"--use-system-ca \""+entry+"\"") {
                WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,
                RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=new UTF8Encoding(false),StandardErrorEncoding=new UTF8Encoding(false)},EnableRaisingEvents=true};
            foreach(var key in new[]{"NODE_OPTIONS","NODE_PATH","NODE_TLS_REJECT_UNAUTHORIZED","OPENAI_API_KEY","OPENAI_BASE_URL"}) process.StartInfo.EnvironmentVariables.Remove(key);
            process.Exited+=(_,__)=>Disconnected?.Invoke();
            process.Start(); input=new StreamWriter(process.StandardInput.BaseStream,new UTF8Encoding(false)){AutoFlush=true};
        }
        public void Listen() { _=ReadLines(); _=DrainErrors(); }
        private async Task DrainErrors() {
            // Never retain raw provider diagnostics or credentials.
            var chars=new char[2048]; try { while(await process.StandardError.ReadAsync(chars,0,chars.Length)>0) { } } catch { }
        }
        private async Task ReadLines() {
            var buffer=new StringBuilder(); var chars=new char[4096];
            try {
                int count;
                while((count=await process.StandardOutput.ReadAsync(chars,0,chars.Length).ConfigureAwait(false))>0) {
                    for(int i=0;i<count;i++) {
                        if(chars[i]=='\n') { var line=buffer.ToString(); buffer.Clear(); Message?.Invoke(Wire.Parse(line)); }
                        else { buffer.Append(chars[i]); if(buffer.Length>1024*1024) throw new OfficeFault("worker_message_limit"); }
                    }
                }
            } catch { }
            Disconnected?.Invoke();
        }
        public void Send(object message) {
            lock(gate) { if(disposed) throw new OfficeFault("worker_disconnected"); input.WriteLine(Wire.Json(message)); }
        }
        public void Dispose() {
            lock(gate) { if(disposed)return; disposed=true; try {input.Close();if(!process.HasExited)process.Kill();}catch{} }
            process.Dispose();
        }
    }
}
