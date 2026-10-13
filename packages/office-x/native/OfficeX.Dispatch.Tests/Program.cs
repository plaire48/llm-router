using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Linq;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using OfficeX.Core;
using OfficeX.ExcelHost;
class Program {
 static void Equal(object a,object b){if(!object.Equals(a,b))throw new Exception("Expected "+a+", got "+b);}
 [STAThread]static void Main(){object dictionary=Activator.CreateInstance(Type.GetTypeFromProgID("Scripting.Dictionary",true));
  try{
   OfficeDispatch.Invoke(dictionary,"Add","call",new object[]{"name","누비"});Equal(1,OfficeDispatch.Get(dictionary,"Count"));Equal("누비",OfficeDispatch.Get(dictionary,"Item","name"));
   Equal("누비",OfficeDispatch.Invoke(dictionary,"Item","call",new object[]{"name"}));
   OfficeDispatch.Invoke(dictionary,"Item","set",new object[]{"name","변경"});Equal("변경",OfficeDispatch.Get(dictionary,"Item","name"));
   var data=new object[,]{{"항목",100},{"합계",200}};OfficeDispatch.Invoke(dictionary,"Add","call",new object[]{"matrix",data});var read=(Array)OfficeDispatch.Get(dictionary,"Item","matrix");Equal("합계",read.GetValue(read.GetLowerBound(0)+1,read.GetLowerBound(1)));Equal(200,read.GetValue(read.GetLowerBound(0)+1,read.GetLowerBound(1)+1));
   try{OfficeDispatch.Invoke(dictionary,"MissingMember","set",new object[]{42});throw new Exception("Expected lookup failure");}catch(OfficeFault e){Equal("office_member_not_found",e.Message);Equal(false,e.InvocationStarted);Equal("MissingMember",e.Member);}
   var session=new OfficeAutomationSession(new DictionaryPort(dictionary));
   var reads=new List<OfficeStep>{new OfficeStep{Action="call",Member="Item",Args=new JArray("name")}};
   var snapshot=session.Inspect(reads);var checks=new List<OfficeCheck>{new OfficeCheck{Read=reads[0],Equals=new JValue("Native STA change")}};
   var writes=new List<OfficeStep>{reads[0],new OfficeStep{Action="set",Member="Item",Args=new JArray("name"),Value=new JValue("Native STA change")}};
   var plan=session.Prepare(snapshot.SnapshotId,"STA dispatch",writes,checks);var receipt=session.Apply(plan.Id,true,default);Equal("verified",receipt.Status);Equal(1,receipt.CompletedWrites);
   snapshot=session.Inspect(reads);writes[1].Member="MissingMember";plan=session.Prepare(snapshot.SnapshotId,"No write on lookup failure",writes,checks);receipt=session.Apply(plan.Id,true,default);Equal(0,receipt.CompletedWrites);Equal(false,receipt.Mutated);Equal(true,OfficeCallPolicy.CanReplan(receipt));
   Equal(2,OfficeDispatch.Get(dictionary,"Count"));OfficeDispatch.Invoke(dictionary,"RemoveAll","call",new object[0]);Equal(0,OfficeDispatch.Get(dictionary,"Count"));
   Console.WriteLine("PASS Windows IDispatch method, argument order, property get/set, SAFEARRAY, missing-member no-write checks. Office runtime not tested.");
  }catch(OfficeFault e){Console.Error.WriteLine(Wire.Json(new{error=e.Message,member=e.Member,nativeCode=e.NativeCode,invocationStarted=e.InvocationStarted}));throw;}finally{Marshal.ReleaseComObject(dictionary);}
 }
 sealed class DictionaryPort:IOfficeAutomationPort {readonly object target;readonly int owner=Thread.CurrentThread.ManagedThreadId;public DictionaryPort(object target){this.target=target;}public void CheckSource(){if(owner!=Thread.CurrentThread.ManagedThreadId)throw new OfficeFault("office_thread_required",invocationStarted:false);}public object Execute(OfficeStep step,bool readOnly){CheckSource();OfficeCallPolicy.Validate(step.Member,readOnly,step.Action);var args=step.Args.Select(a=>a.ToObject<object>()).ToList();if(step.Action=="set")args.Add(step.Value.ToObject<object>());return OfficeDispatch.Invoke(target,step.Member,step.Action,args.ToArray());}}
}
