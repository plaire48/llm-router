using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Linq;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using OfficeX.Core;
using OfficeX.ExcelHost;
class Program {
 static void Equal(object a,object b){if(!object.Equals(a,b))throw new Exception("Expected "+a+", got "+b);}
 [STAThread]static void Main(string[] args){if(args.Length>0)Equal(args[0],IntPtr.Size==8?"x64":"x86");Console.WriteLine("Native test process: "+(IntPtr.Size==8?"x64":"x86"));AssertAnyCPU(typeof(OfficeAutomationPort).Assembly);AssertAnyCPU(typeof(OfficeAutomationSession).Assembly);object dictionary=Activator.CreateInstance(Type.GetTypeFromProgID("Scripting.Dictionary",true));
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
   ExcelDocumentRegression();
   Console.WriteLine("PASS Windows IDispatch method, argument order, property get/set, SAFEARRAY, missing-member no-write checks. Office runtime not tested.");
  }catch(OfficeFault e){Console.Error.WriteLine(Wire.Json(new{error=e.Message,member=e.Member,nativeCode=e.NativeCode,invocationStarted=e.InvocationStarted}));throw;}finally{Marshal.ReleaseComObject(dictionary);}
 }
 static void AssertAnyCPU(Assembly assembly){assembly.ManifestModule.GetPEKind(out var kind,out var machine);Equal(false,(kind&PortableExecutableKinds.Required32Bit)!=0);Equal(false,(kind&PortableExecutableKinds.PE32Plus)!=0);}
 [DllImport("ExcelFixture.dll",CallingConvention=CallingConvention.Cdecl,CharSet=CharSet.Unicode)]static extern int CreateExcelFixture(string source,[MarshalAs(UnmanagedType.IDispatch)]out object application);
 [DllImport("ExcelFixture.dll",CallingConvention=CallingConvention.Cdecl)]static extern void GetExcelFixtureStats(out int typeInfo,out int writes,out int copies);
 static void ExcelDocumentRegression(){
  var source=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N")+".xlsx");
  using(var zip=ZipFile.Open(source,ZipArchiveMode.Create)){using(var writer=new StreamWriter(zip.CreateEntry("xl/workbook.xml").Open()))writer.Write("<workbook/>");}
  object app=null;
  try{
   Marshal.ThrowExceptionForHR(CreateExcelFixture(source,out app));
   bool legacyFailed=false;string legacyException=null,legacyCode=null;
   try{var window=((dynamic)app).ActiveWindow;}
   catch(Exception e){legacyFailed=true;legacyException=e.GetType().Name;legacyCode="0x"+unchecked((uint)e.HResult).ToString("X8");}
   Equal(true,legacyFailed);GetExcelFixtureStats(out int legacyInfo,out _,out _);Equal(true,legacyInfo>0);
   Console.WriteLine("REPRO legacy dynamic Excel access fails: "+legacyException+" "+legacyCode+"; broken type-info calls="+legacyInfo);
   Marshal.ReleaseComObject(app);app=null;Marshal.ThrowExceptionForHR(CreateExcelFixture(source,out app));
   // Both new sheets must be read back from native SAFEARRAY values.
   var draft=new DocumentDraft{Title="주간 매출",Sheets=new List<SheetContent>{
    new SheetContent{Name="매출",Rows=new List<List<string>>{new List<string>{"품목","금액"},new List<string>{"상품 A","1000"}}},
    new SheetContent{Name="일정",Rows=new List<List<string>>{new List<string>{"담당","날짜"},new List<string>{"누비","월요일"}}}}};
   using(var creationPort=new DocumentCreationPort(app,"excel",12345)){
    var creation=new DocumentCreation(creationPort,"excel",draft);var receipt=creation.Apply(creation.Plan.Id,true,default);
    if(receipt.Status!="verified")Console.Error.WriteLine(Wire.Json(receipt));Equal("verified",receipt.Status);Equal(2,receipt.Count);Equal("Book1",receipt.Document);
    creationPort.ActivateCreated();Equal(Wire.Hash(draft),Wire.Hash(creationPort.ReadCreated()));
   }
   using(var port=new OfficeAutomationPort(app,"excel",12345))using(var files=new OfficeFiles(app,"excel",()=>port)){
    // A rollback checkpoint must not consult the broken type library or change cells.
    var checkpoint=Wire.Object(files.CheckpointNow("입력 전"));Equal(true,(bool)checkpoint["encrypted"]);
    var session=new OfficeAutomationSession(port);
    var reads=new List<OfficeStep>{new OfficeStep{Id="sheets",Member="Worksheets"},new OfficeStep{Id="sheet",Target="sheets",Action="call",Member="Item",Args=new JArray(1)},new OfficeStep{Id="range",Target="sheet",Action="call",Member="Range",Args=new JArray("A1","B2")},new OfficeStep{Target="range",Member="Value2"}};
    var before=session.Inspect(reads);
    var values=new JArray(new JArray("항목","금액"),new JArray("실제 입력",3500));
    var plan=session.Prepare(before.SnapshotId,"셀에 값 입력",new List<OfficeStep>{new OfficeStep{Target="range",Action="set",Member="Value2",Value=values}},new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="range",Member="Value2"},Equals=values}});
    var receipt=session.Apply(plan.Id,true,default);Equal("verified",receipt.Status);Equal(1,receipt.CompletedWrites);
    Equal(Wire.Json(values),Wire.Json(port.Execute(new OfficeStep{Target="range",Member="Value2"},true)));
    files.CheckpointNow("입력 후");
    before=session.Inspect(reads);var largeNumber=new JValue(5000000000L);
    plan=session.Prepare(before.SnapshotId,"32비트 범위보다 큰 숫자 입력",new List<OfficeStep>{new OfficeStep{Target="range",Action="set",Member="Value2",Value=largeNumber}},new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="range",Member="Value2"},Equals=largeNumber}});
    receipt=session.Apply(plan.Id,true,default);Equal("verified",receipt.Status);Equal(5000000000d,port.Execute(new OfficeStep{Target="range",Member="Value2"},true));
   }
   GetExcelFixtureStats(out int info,out int writes,out int copies);Equal(0,info);Equal(4,writes);Equal(4,copies);
   Marshal.ReleaseComObject(app);app=null;
   File.WriteAllBytes(source,new byte[]{0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1,0,0,0,0});
   Marshal.ThrowExceptionForHR(CreateExcelFixture(source,out app));
   using(var binaryPort=new OfficeAutomationPort(app,"excel",12345))using(var binaryFiles=new OfficeFiles(app,"excel",()=>binaryPort)){
    var binaryCheckpoint=Wire.Object(binaryFiles.CheckpointNow("Excel 97-2003 형식 사본"));Equal(true,(bool)binaryCheckpoint["encrypted"]);Equal(true,binaryFiles.State().Length==64);
   }
   Directory.CreateDirectory("verification");File.WriteAllText("verification/native-dispatch-"+(IntPtr.Size==8?"x64":"x86")+".json",Wire.Json(new{passed=true,architecture=IntPtr.Size==8?"x64":"x86",legacyFailed,legacyException,legacyCode,legacyTypeInfoCalls=legacyInfo,typeInfoCalls=info,valueWrites=writes,checkpointCopies=copies,creationSheets=2,matrixReadback=true,largeIntegerReadback=true,binaryCheckpoint=true,hostAnyCPU=true,coreAnyCPU=true,realOfficeVerified=false}));
   Console.WriteLine("PASS Excel-shaped native COM with TYPE_E_INVDATAREAD: two-sheet creation, SAFEARRAY cell writes/readback, encrypted checkpoints; zero type-info calls. This fixture is not installed Excel.");
  }finally{if(app!=null)Marshal.ReleaseComObject(app);File.Delete(source);}
 }
 sealed class DictionaryPort:IOfficeAutomationPort {readonly object target;readonly int owner=Thread.CurrentThread.ManagedThreadId;public DictionaryPort(object target){this.target=target;}public void CheckSource(){if(owner!=Thread.CurrentThread.ManagedThreadId)throw new OfficeFault("office_thread_required",invocationStarted:false);}public object Execute(OfficeStep step,bool readOnly){CheckSource();OfficeCallPolicy.Validate(step.Member,readOnly,step.Action);var args=step.Args.Select(a=>a.ToObject<object>()).ToList();if(step.Action=="set")args.Add(step.Value.ToObject<object>());return OfficeDispatch.Invoke(target,step.Member,step.Action,args.ToArray());}}
}
