using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace OfficeX.Core
{
    public interface IOfficeWorker : IDisposable
    {
        event Action<JObject> Message;
        event Action Disconnected;
        void Listen();
        void Send(object message);
    }

    // One live connection per Office process. Windows own document bindings, not logins.
    // All callbacks and membership changes are serialized on the Office UI context.
    public sealed class WindowWorkerSession : IDisposable
    {
        private readonly Func<IOfficeWorker> create;
        private readonly Action<Action> dispatch;
        private readonly Dictionary<object,Action<JObject>> clients=new Dictionary<object,Action<JObject>>();
        private JObject provider;
        private object owner;
        private string runId;
        public IOfficeWorker Worker {get;private set;}
        public bool Busy=>runId!=null;
        public string Permission {get;private set;}="confirm";
        public void SetPermission(string mode){if(Busy)throw new OfficeFault("worker_busy");Permission=OfficePermissions.Validate(mode);Broadcast(new JObject{{"type","permission_state"},{"mode",Permission}});}
        public int Count=>clients.Count;
        public WindowWorkerSession(Func<IOfficeWorker> create,Action<Action> dispatch){this.create=create;this.dispatch=dispatch;}
        public void Attach(object client,Action<JObject> receive){clients[client]=receive;receive(new JObject{{"type","permission_state"},{"mode",Permission}});if(provider!=null)receive((JObject)provider.DeepClone());BroadcastBusy();}
        public void Ensure(){
            if(Worker!=null)return;
            var worker=create();Worker=worker;
            worker.Message+=message=>dispatch(()=>{if(ReferenceEquals(Worker,worker))Receive(message);});
            worker.Disconnected+=()=>dispatch(()=>{
                if(!ReferenceEquals(Worker,worker))return;
                Worker=null;provider=null;runId=null;owner=null;
                Broadcast(new JObject{{"type","disconnected"}});BroadcastBusy();worker.Dispose();
            });
            worker.Listen();
        }
        public void Acquire(object client,string id){if(!clients.ContainsKey(client))throw new OfficeFault("worker_disconnected");if(Busy)throw new OfficeFault("worker_busy");owner=client;runId=id;BroadcastBusy();}
        public void Release(object client){if(!ReferenceEquals(owner,client))return;runId=null;owner=null;BroadcastBusy();}
        public void Detach(object client){
            clients.Remove(client);
            if(ReferenceEquals(owner,client)&&Busy){try{Worker?.Send(new{type="cancel",runId});}catch{}}
            if(clients.Count==0)Dispose();
        }
        private void Receive(JObject message){
            var type=(string)message["type"];
            if(type=="provider_state")provider=(JObject)message.DeepClone();
            if(new[]{"provider_state","context_state","context_compacting","reply"}.Contains(type)){Broadcast(message);return;}
            if(type=="ready"||type=="vault_write"){
                var recipient=clients.Values.FirstOrDefault();recipient?.Invoke(message);return;
            }
            if((string)message["runId"]!=runId||runId==null)return;
            if(owner!=null&&clients.TryGetValue(owner,out var receive))receive(message);
            else if(type=="done"||type=="error"){runId=null;owner=null;BroadcastBusy();}
        }
        private void Broadcast(JObject message){foreach(var receive in clients.Values.ToArray())receive((JObject)message.DeepClone());}
        private void BroadcastBusy(){foreach(var client in clients.ToArray())client.Value(new JObject{{"type","session_busy"},{"busy",Busy&&!ReferenceEquals(owner,client.Key)}});}
        public void Dispose(){var worker=Worker;Worker=null;provider=null;runId=null;owner=null;clients.Clear();worker?.Dispose();}
    }
}
