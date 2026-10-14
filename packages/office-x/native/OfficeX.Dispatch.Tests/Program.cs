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
 [STAThread]static void Main(string[] args){foreach(var app in new[]{"excel","word","powerpoint"}){var startup=TaskPaneStartupDiagnostics.Describe(new ArgumentException("private document path and content","title"),app,"pane_add_quiet");Equal(true,startup.Contains("Office 작업창 생성"));Equal(true,startup.Contains("title"));Equal(true,startup.Contains("ArgumentException"));Equal(false,startup.Contains("private"));}if(args.Length>0)Equal(args[0],IntPtr.Size==8?"x64":"x86");Console.WriteLine("Native test process: "+(IntPtr.Size==8?"x64":"x86"));AssertAnyCPU(typeof(OfficeAutomationPort).Assembly);AssertAnyCPU(typeof(OfficeAutomationSession).Assembly);object dictionary=Activator.CreateInstance(Type.GetTypeFromProgID("Scripting.Dictionary",true));
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
   PowerPointWindowRegression();
   ExcelDocumentRegression();
   MarkdownExportRegression();
   Console.WriteLine("PASS Windows IDispatch method, argument order, property get/set, SAFEARRAY, missing-member no-write checks. Office runtime not tested.");
  }catch(OfficeFault e){Console.Error.WriteLine(Wire.Json(new{error=e.Message,member=e.Member,nativeCode=e.NativeCode,invocationStarted=e.InvocationStarted}));throw;}finally{Marshal.ReleaseComObject(dictionary);}
 }
 static void PowerPointWindowRegression(){object app=null,window=null;try{Marshal.ThrowExceptionForHR(CreateExcelFixture("unused",out app));using(var port=new OfficeAutomationPort(app,"powerpoint",12345)){window=OfficeDispatch.Get(app,"ActiveWindow");try{OfficeDispatch.Get(window,"HWND");throw new Exception("Expected HWND name lookup failure");}catch(OfficeFault e){Equal("office_member_not_found",e.Message);Equal("HWND",e.Member);}port.CheckSource();using(var creator=new DocumentCreationPort(app,"powerpoint",12345))creator.CheckSource();GetExcelFixtureStats(out var info,out _,out _);Equal(0,info);}}finally{if(window!=null)Marshal.ReleaseComObject(window);if(app!=null)Marshal.ReleaseComObject(app);}}
 static void AssertAnyCPU(Assembly assembly){assembly.ManifestModule.GetPEKind(out var kind,out var machine);Equal(false,(kind&PortableExecutableKinds.Required32Bit)!=0);Equal(false,(kind&PortableExecutableKinds.PE32Plus)!=0);}
 static void MarkdownExportRegression(){var folder=Path.Combine(Path.GetTempPath(),"nubi-markdown-native-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);var results=new List<object>();
  try{foreach(string host in new[]{"excel","word","powerpoint"}){object app=null;try{Marshal.ThrowExceptionForHR(CreateExcelFixture("unused",out app));SetExcelFixtureCopyFailure(unchecked((int)0x800A03EC));
   if(host!="excel"){var draft=host=="word"?new DocumentDraft{Title="원문",Paragraphs=new List<DocumentPart>{new DocumentPart{Style="Normal",Text="보존할 본문"}}}:new DocumentDraft{Title="원문",Slides=new List<SlideContent>{new SlideContent{Title="보존할 제목",Body=new List<string>{"보존할 본문"}}}};using(var creator=new DocumentCreationPort(app,host,12345)){var creation=new DocumentCreation(creator,host,draft);Equal("verified",creation.Apply(creation.Plan.Id,true,default).Status);creator.ActivateCreated();}}
   using(var bound=new OfficeAutomationPort(app,host,12345))using(var files=new OfficeFiles(app,host,()=>bound)){
    if(host=="excel"){object sheets=null,sheet=null,range=null;try{sheets=OfficeDispatch.Get(bound.BoundDocument,"Worksheets");sheet=OfficeDispatch.Get(sheets,"Item",1);range=OfficeDispatch.Get(sheet,"Range","A1");OfficeDispatch.Set(range,"Value2","보존할 셀 값");}finally{if(range!=null)Marshal.ReleaseComObject(range);if(sheet!=null)Marshal.ReleaseComObject(sheet);if(sheets!=null)Marshal.ReleaseComObject(sheets);}}
    GetExcelFixtureStats(out _,out int beforeWrites,out _);var snapshot=Wire.Object(files.ReadForMarkdown(default));var source=JObject.Parse(File.ReadAllText((string)snapshot["path"]));
    Equal(host,(string)source["kind"]);Equal(true,source.ToString().Contains(host=="excel"?"보존할 셀 값":"보존할 본문"));var previousContext=SynchronizationContext.Current;JObject again;try{SynchronizationContext.SetSynchronizationContext(new System.Windows.Forms.WindowsFormsSynchronizationContext());var pending=files.ReadForMarkdownAsync(default);while(!pending.IsCompleted){System.Windows.Forms.Application.DoEvents();Thread.Sleep(1);}again=Wire.Object(pending.GetAwaiter().GetResult());}finally{SynchronizationContext.SetSynchronizationContext(previousContext);}Equal((string)snapshot["sourceHash"],(string)again["sourceHash"]);Equal(0,GetExcelFixtureCopyAttempts());GetExcelFixtureStats(out int info,out int afterWrites,out _);Equal(beforeWrites,afterWrites);Equal(0,info);
    string artifact=Path.Combine(files.Folder,"export.md"),target=Path.Combine(folder,host,"새 경로","보고서.md");byte[] bytes=new System.Text.UTF8Encoding(false).GetBytes("# 보존할 원문\n\n| 값 | 수식 |\n| --- | --- |\n| 1200 | =A1*2 |\n");File.WriteAllBytes(artifact,bytes);var saved=Wire.Object(files.SaveMarkdown(artifact,target,default));Equal(true,(bool)saved["saved"]);Equal(target,(string)saved["destination"]);Equal(true,File.ReadAllBytes(target).SequenceEqual(bytes));
    byte[] changed=new System.Text.UTF8Encoding(false).GetBytes("# 두 번째 저장\n");File.WriteAllBytes(artifact,changed);files.SaveMarkdown(artifact,target,default);Equal(true,File.ReadAllBytes(target).SequenceEqual(changed));Equal(0,Directory.GetFiles(Path.GetDirectoryName(target),".nubi-*.tmp").Length);
    foreach(string invalid in new[]{"relative.md",@"C:\export\bad.txt",@"\\.\pipe\bad.md",@"C:\export\bad.md:stream.md"}){try{OfficeFiles.MarkdownDestination(invalid);throw new Exception("invalid export path accepted");}catch(OfficeFault e){Equal("markdown_destination_invalid",e.Message);}}
    using(var cancel=new CancellationTokenSource()){cancel.Cancel();try{files.SaveMarkdown(artifact,target,cancel.Token);throw new Exception("cancelled save accepted");}catch(OperationCanceledException){Equal(true,File.ReadAllBytes(target).SequenceEqual(changed));}}
    results.Add(new{app=host,readWithoutSaveCopyAs=true,readWithoutTypeInfo=true,sourceNotMutated=true,stableSourceHash=true,asyncReadStaysOnSta=true,utf8SavedAndReadback=true,atomicReplace=true,requestedPath=true,cancelPreservesFile=true});
   }
  }finally{if(app!=null)Marshal.ReleaseComObject(app);}}Directory.CreateDirectory("verification");File.WriteAllText("verification/native-markdown-"+(IntPtr.Size==8?"x64":"x86")+".json",Wire.Json(new{passed=true,architecture=IntPtr.Size==8?"x64":"x86",results,actualOffice=false}));
  }finally{Directory.Delete(folder,true);}
 }
 [DllImport("ExcelFixture.dll",CallingConvention=CallingConvention.Cdecl,CharSet=CharSet.Unicode)]static extern int CreateExcelFixture(string source,[MarshalAs(UnmanagedType.IDispatch)]out object application);
 [DllImport("ExcelFixture.dll",CallingConvention=CallingConvention.Cdecl)]static extern void GetExcelFixtureStats(out int typeInfo,out int writes,out int copies);
 [DllImport("ExcelFixture.dll",CallingConvention=CallingConvention.Cdecl)]static extern void SetExcelFixtureCopyFailure(int code);
 [DllImport("ExcelFixture.dll",CallingConvention=CallingConvention.Cdecl)]static extern int GetExcelFixtureCopyAttempts();
 [DllImport("ExcelFixture.dll",CallingConvention=CallingConvention.Cdecl)]static extern void SetExcelFixtureActiveSheet(int index);
 static void RefusedCopyRegression(string source){
  Marshal.ThrowExceptionForHR(CreateExcelFixture(source,out var app));
  try{using(var port=new OfficeAutomationPort(app,"excel",12345))using(var files=new OfficeFiles(app,"excel",()=>port)){
   SetExcelFixtureCopyFailure(unchecked((int)0x800A03EC));
   var checkpoint=Wire.Object(files.PrepareCheckpoint("셀 입력 전"));Equal(false,(bool)checkpoint["available"]);Equal(false,(bool)checkpoint["mutated"]);Equal("SaveCopyAs",(string)checkpoint["failedMember"]);Equal("0x800A03EC",(string)checkpoint["nativeCode"]);Equal(0,((JArray)Wire.Object(new{list=files.ListCheckpoints()})["list"]).Count);Equal(0,Directory.GetFiles(files.Folder).Length);
   var warning=Wire.Object(files.RequestCheckpoint("다시 백업 요청"));Equal("unavailable",(string)warning["status"]);Equal(null,warning["error"]);Equal(true,(bool)warning["canContinueEditing"]);Equal(1,GetExcelFixtureCopyAttempts());
   GetExcelFixtureStats(out _,out int beforeWrites,out _);Equal(0,beforeWrites);
   var session=new OfficeAutomationSession(port);var reads=new List<OfficeStep>{new OfficeStep{Id="sheets",Member="Worksheets"},new OfficeStep{Id="sheet",Target="sheets",Member="Item",Args=new JArray(1)},new OfficeStep{Id="range",Target="sheet",Member="Range",Args=new JArray("A1","B2")},new OfficeStep{Target="range",Member="Value2"}};
   var before=session.Inspect(reads);var values=new JArray(new JArray("항목","값"),new JArray("사본 실패 후 입력",42));var plan=session.Prepare(before.SnapshotId,"명시적 승인 후 입력",new List<OfficeStep>{new OfficeStep{Target="range",Action="set",Member="Value2",Value=values}},new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="range",Member="Value2"},Equals=values}});
   Equal("verified",session.Apply(plan.Id,true,default).Status);Equal(Wire.Json(values),Wire.Json(port.Execute(new OfficeStep{Target="range",Member="Value2"},true)));GetExcelFixtureStats(out int info,out int writes,out _);Equal(0,info);Equal(1,writes);
  }}finally{Marshal.ReleaseComObject(app);}
 }
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
    new SheetContent{Name="매출",Rows=new List<List<string>>{new List<string>{"품목","금액","비고"},new List<string>{"상품 A\n세부 항목\t확인","1000"}}},
    new SheetContent{Name="일정",Rows=new List<List<string>>{new List<string>{"담당","날짜"},new List<string>{"누비","월요일"}}}}};
   using(var creationPort=new DocumentCreationPort(app,"excel",12345)){
    var creation=new DocumentCreation(creationPort,"excel",draft);var receipt=creation.Apply(creation.Plan.Id,true,default);
    if(receipt.Status!="verified")Console.Error.WriteLine(Wire.Json(receipt));Equal("verified",receipt.Status);Equal(2,receipt.Count);Equal("Book1",receipt.Document);
    creationPort.ActivateCreated();Equal(Wire.Hash(creation.Plan.Content),Wire.Hash(creationPort.ReadCreated()));Equal("",creationPort.ReadCreated().Sheets[0].Rows[1][2]);Equal("상품 A\n세부 항목\t확인",creationPort.ReadCreated().Sheets[0].Rows[1][0]);
    using(var rebound=new OfficeAutomationPort(app,"excel",12345)){Equal(creationPort.CreatedDocumentId,rebound.DocumentId);rebound.CheckSource();
     using(var backups=new OfficeFiles(app,"excel",()=>rebound)){SetExcelFixtureCopyFailure(unchecked((int)0x800A03EC));var unavailable=Wire.Object(backups.RequestCheckpoint("새 문서 입력 전"));Equal("unavailable",(string)unavailable["status"]);SetExcelFixtureActiveSheet(2);var cells=new OfficeAutomationSession(rebound);var literals=ExcelCellWrites.Prepare(cells,JObject.Parse("{operations:[{address:'Z20',value:'=1+1'},{address:'Z21',value:42},{address:'Z22',value:true},{address:'Z23',value:null}]}"),null);Equal("verified",cells.Apply(literals.Id,true,default).Status);var formula=ExcelCellWrites.Prepare(cells,JObject.Parse("{operations:[{address:'Z24',formula:'=SUM(A1:A3)'}]}"),null);Equal("verified",cells.Apply(formula.Id,true,default).Status);Equal(1,GetExcelFixtureCopyAttempts());
      var targets=cells.Inspect(new List<OfficeStep>{new OfficeStep{Id="verify_sheets",Member="Worksheets"},new OfficeStep{Id="verify_first",Target="verify_sheets",Member="Item",Args=new JArray(1)},new OfficeStep{Id="verify_second",Target="verify_sheets",Member="Item",Args=new JArray(2)},new OfficeStep{Id="verify_first_cell",Target="verify_first",Member="Range",Args=new JArray("Z20")},new OfficeStep{Target="verify_first_cell",Member="Value2"},new OfficeStep{Id="verify_second_cell",Target="verify_second",Member="Range",Args=new JArray("Z20")},new OfficeStep{Target="verify_second_cell",Member="Value2"}});Equal(null,targets.Results[4]);Equal("=1+1",targets.Results[6]);SetExcelFixtureActiveSheet(1);SetExcelFixtureCopyFailure(0);}
    }
   }
   using(var port=new OfficeAutomationPort(app,"excel",12345))using(var files=new OfficeFiles(app,"excel",()=>port)){
    OfficeDispatch.Set(port.BoundDocument,"Name","renamed.csv");
    var wrongCopy=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N")+".csv");
    try{OfficeDispatch.Call(port.BoundDocument,"SaveCopyAs",wrongCopy);throw new Exception("Expected copy format failure");}catch(OfficeFault e){Equal("SaveCopyAs",e.Member);Equal("0x800A03EC",e.NativeCode);}finally{if(File.Exists(wrongCopy))File.Delete(wrongCopy);}
    // A rollback checkpoint must not consult the broken type library or change cells.
    var checkpoint=Wire.Object(files.CheckpointNow("입력 전"));Equal(true,(bool)checkpoint["encrypted"]);
    var session=new OfficeAutomationSession(port);
    var reads=new List<OfficeStep>{new OfficeStep{Id="sheets",Member="Worksheets"},new OfficeStep{Id="sheet",Target="sheets",Action="call",Member="Item",Args=new JArray(1)},new OfficeStep{Id="range",Target="sheet",Action="call",Member="Range",Args=new JArray("A1","B2")},new OfficeStep{Target="range",Member="Value2"}};
    var before=session.Inspect(reads);
    var values=new JArray(new JArray("항목","금액"),new JArray("실제 입력",3500));
    var plan=session.Prepare(before.SnapshotId,"셀에 값 입력",new List<OfficeStep>{new OfficeStep{Target="range",Action="set",Member="Value2",Value=values}},new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="range",Member="Value2"},Equals=values}});
    var receipt=session.Apply(plan.Id,true,default);Equal("verified",receipt.Status);Equal(1,receipt.CompletedWrites);
    Equal(Wire.Json(values),Wire.Json(port.Execute(new OfficeStep{Target="range",Member="Value2"},true)));
    Equal(Wire.Json(values),Wire.Json(port.Execute(new OfficeStep{Target="range",Action="call",Member="Value2"},true)));
    port.Execute(new OfficeStep{Target="range",Action="set",Member="Font.Bold",Value=true},false);
    Equal(true,port.Execute(new OfficeStep{Target="range",Action="call",Member="Font.Bold"},true));
    port.Execute(new OfficeStep{Target="range.Font",Action="set",Member="Size",Value=14},false);
    Equal(14d,Convert.ToDouble(port.Execute(new OfficeStep{Target="range",Member="Font.Size"},true)));
    port.Execute(new OfficeStep{Target="document",Action="set",Member="Content.Font.Size",Value=16},false);
    Equal(16d,Convert.ToDouble(port.Execute(new OfficeStep{Member="Content.Font.Size",Action="call"},true)));
    port.Execute(new OfficeStep{Target="range",Action="set",Member="TextFrame.TextRange.Text",Value="발표 본문"},false);
    Equal("발표 본문",port.Execute(new OfficeStep{Target="range",Action="call",Member="TextFrame.TextRange.Text"},true));
    foreach(var member in new[]{"Font.Application.Name","Font.SaveAs","Font.AddPicture"}){try{port.Execute(new OfficeStep{Target="range",Member=member},true);throw new Exception("Expected denied path");}catch(OfficeFault e){Equal("office_member_unavailable",e.Message);Equal(false,e.InvocationStarted);}}
    try{port.Execute(new OfficeStep{Target="range",Member="Font.Bold.Value2"},true);throw new Exception("Expected scalar path rejection");}catch(OfficeFault e){Equal("office_member_path_not_supported",e.Message);Equal(false,e.InvocationStarted);}
    try{port.Execute(new OfficeStep{Target="range",Member="Rows.AutoFit",Action="call"},true);throw new Exception("Expected read-only mutation rejection");}catch(OfficeFault e){Equal("office_read_requires_get",e.Message);Equal(false,e.InvocationStarted);}
    files.CheckpointNow("입력 후");
    before=session.Inspect(reads);var largeNumber=new JValue(5000000000L);
    plan=session.Prepare(before.SnapshotId,"32비트 범위보다 큰 숫자 입력",new List<OfficeStep>{new OfficeStep{Target="range",Action="set",Member="Value2",Value=largeNumber}},new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="range",Member="Value2"},Equals=largeNumber}});
    receipt=session.Apply(plan.Id,true,default);Equal("verified",receipt.Status);Equal(5000000000d,port.Execute(new OfficeStep{Target="range",Member="Value2"},true));
   }
   GetExcelFixtureStats(out int info,out int writes,out int copies);Equal(0,info);Equal(9,writes);Equal(2,copies);
   using(var port=new OfficeAutomationPort(app,"excel",12345)){
    var session=new OfficeAutomationSession(port);var plan=ExcelCellWrites.Prepare(session,Wire.Parse("{operations:[{address:'F9',formula:'=2*3'}]}"),null);Equal("verified",session.Apply(plan.Id,true,default).Status);
    var indexed=new List<OfficeStep>{new OfficeStep{Target="Worksheets.Item.Range",Member="Value2",Args=new JArray(1,"F10")}};var indexedBefore=session.Inspect(indexed);var indexedPlan=session.Prepare(indexedBefore.SnapshotId,"Explicit indexed path",new List<OfficeStep>{new OfficeStep{Member="Worksheets.Item.Range.Value2",Action="set",Args=new JArray(1,"F10"),Value=27}},new List<OfficeCheck>{new OfficeCheck{Read=indexed[0],Equals=27}});Equal("verified",session.Apply(indexedPlan.Id,true,default).Status);Equal(27,port.Execute(indexed[0],true));
    try{port.Execute(new OfficeStep{Target="Worksheets.Item.Range",Member="Value2"},true);throw new Exception("guessed selectors");}catch(OfficeFault e){Equal("office_argument_count",e.Message);Equal(false,e.InvocationStarted);}
    var reads=ExcelRangeTools.ReadSteps(null,"F9","calculation");session.Inspect(reads);var result=Wire.Object(port.Calculate("calculation_range",default));Equal("calculated",(string)result["status"]);var calculated=session.Inspect(reads);Equal(6d,calculated.Results[3]);Equal("=2*3",calculated.Results[4]);
    result=Wire.Object(port.Calculate("document",default));Equal("calculated",(string)result["status"]);
    plan=ExcelRangeTools.PrepareMerge(session,Wire.Parse("{address:'D10:E10'}"),null);Equal("verified",session.Apply(plan.Id,true,default).Status);plan=ExcelRangeTools.PrepareMerge(session,Wire.Parse("{address:'D10:E10',unmerge:true}"),null);Equal("verified",session.Apply(plan.Id,true,default).Status);
    try{port.Execute(new OfficeStep{Target="calculation_sheet",Member="Item"},true);throw new Exception("guessed missing Item");}catch(OfficeFault e){Equal("office_argument_count",e.Message);Equal("0x8002000E",e.NativeCode);Equal(false,e.InvocationStarted);Equal("item_index_required",e.InputRule);}
    var sheets=session.Inspect(new List<OfficeStep>{new OfficeStep{Id="argument_sheets",Member="Worksheets"},new OfficeStep{Id="argument_sheet",Target="argument_sheets",Member="Item",Args=new JArray(1)}});
    GetExcelFixtureStats(out _,out int preflightWritesBefore,out _);
    var invalidSteps=new List<OfficeStep>{new OfficeStep{Target="calculation_range",Action="set",Member="Value2",Value=7},new OfficeStep{Target="Worksheets.Item.Range",Member="Value2"}};
    try{session.Prepare(sheets.SnapshotId,"쓰기에 앞선 인자 확인",invalidSteps,new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="calculation_range",Member="Value2"},Equals=7}});throw new Exception("accepted late missing Item selector");}catch(OfficeFault e){Equal("office_argument_count",e.Message);Equal(false,e.InvocationStarted);}
    GetExcelFixtureStats(out _,out int preflightWritesAfter,out _);Equal(preflightWritesBefore,preflightWritesAfter);
    var countRead=new OfficeStep{Target="argument_sheets",Member="Count"};
    var countBefore=session.Inspect(new List<OfficeStep>{new OfficeStep{Id="argument_sheets",Member="Worksheets"},countRead});
    int initialCount=Convert.ToInt32(countBefore.Results[1]);
    var addStep=new OfficeStep{Id="argument_new_sheet",Target="argument_sheets",Action="call",Member="Add",Args=new JArray(Wire.Parse("{missing:true}"),Wire.Parse("{reference:'argument_sheet'}"))};
    try{session.Prepare(countBefore.SnapshotId,"잘못된 예상 개수",new List<OfficeStep>{addStep},new List<OfficeCheck>{new OfficeCheck{Read=countRead,Equals=initialCount}});throw new Exception("accepted wrong total count");}catch(OfficeFault e){Equal("office_count_expectation_invalid",e.Message);Equal(false,e.InvocationStarted);}
    Equal(initialCount,Convert.ToInt32(port.Execute(countRead,true)));
    var countPlan=session.Prepare(countBefore.SnapshotId,"실제 시트 수를 반영해 하나 추가",new List<OfficeStep>{addStep,new OfficeStep{Id="count_new_range",Target="argument_new_sheet",Member="Range",Args=new JArray("A1")},new OfficeStep{Target="count_new_range",Action="set",Member="Value2",Value="count verified"}},new List<OfficeCheck>{new OfficeCheck{Read=countRead,Delta=1},new OfficeCheck{Read=new OfficeStep{Target="count_new_range",Member="Value2"},Equals="count verified"}});
    var countReceipt=session.Apply(countPlan.Id,true,default);Equal("verified",countReceipt.Status);Equal(2,countReceipt.Checks.Count);Equal(initialCount+1,Convert.ToInt32(port.Execute(countRead,true)));
    var scalarRead=session.Inspect(new List<OfficeStep>{new OfficeStep{Id="scalar_old_handle",Member="Worksheets"},new OfficeStep{Target="scalar_old_handle",Member="Count",Id="scalar_old_handle"}});
    try{session.Prepare(scalarRead.SnapshotId,"스칼라 핸들 거절",new List<OfficeStep>{new OfficeStep{Target="calculation_range",Member="Value2",Action="set",Value=999},new OfficeStep{Target="scalar_old_handle",Member="Name",Action="set",Value="wrong object"}},new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="calculation_range",Member="Value2"},Equals=999}});throw new Exception("scalar handle accepted");}catch(OfficeFault e){Equal("office_target_unknown",e.Message);Equal(false,e.InvocationStarted);}
    var setterIdBefore=session.Inspect(new List<OfficeStep>{new OfficeStep{Id="setter_old_handle",Target="argument_new_sheet",Member="Range",Args=new JArray("A1")},new OfficeStep{Target="setter_old_handle",Member="Value2"}});
    try{session.Prepare(setterIdBefore.SnapshotId,"쓰기 결과를 객체로 재사용 금지",new List<OfficeStep>{new OfficeStep{Id="setter_old_handle",Target="setter_old_handle",Member="Value2",Action="set",Value=999},new OfficeStep{Target="setter_old_handle",Member="NumberFormat",Action="set",Value="0.00"}},new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="setter_old_handle",Member="Value2"},Equals=999}});throw new Exception("setter result accepted as object");}catch(OfficeFault e){Equal("office_target_unknown",e.Message);Equal(false,e.InvocationStarted);}
    Equal("count verified",port.Execute(new OfficeStep{Target="setter_old_handle",Member="Value2"},true));
    var indexBefore=session.Inspect(new List<OfficeStep>{new OfficeStep{Id="argument_sheets",Member="Worksheets"},countRead});int observed=Convert.ToInt32(indexBefore.Results[1]);
    var futureIndexPlan=session.Prepare(indexBefore.SnapshotId,"추가 후 존재하는 명시적 인덱스",new List<OfficeStep>{new OfficeStep{Id="future_added",Target="argument_sheets",Member="Add",Action="call",Args=addStep.Args},new OfficeStep{Id="future_item",Target="argument_sheets",Member="Item",Args=new JArray(observed+1)},new OfficeStep{Target="future_item",Member="Name",Action="set",Value="future index"}},new List<OfficeCheck>{new OfficeCheck{Read=countRead,Delta=1},new OfficeCheck{Read=new OfficeStep{Target="future_item",Member="Name"},Equals="future index"}});Equal("verified",session.Apply(futureIndexPlan.Id,true,default).Status);
    var worksheetList=ExcelWorksheets.Read(session);int worksheetCount=worksheetList.Count;string firstName=worksheetList.Worksheets[0].Name;
    object rawCollection=OfficeDispatch.Get(port.BoundDocument,"Worksheets");try{try{OfficeDispatch.Get(rawCollection,"Name");throw new Exception("permissive fixture accepted collection Name");}catch(OfficeFault e){Equal("office_member_not_found",e.Message);Equal("0x80020003",e.NativeCode);}}finally{Marshal.ReleaseComObject(rawCollection);}
    GetExcelFixtureStats(out _,out int worksheetWritesBefore,out _);
    try{session.Inspect(new List<OfficeStep>{new OfficeStep{Member="Worksheets.Name"}});throw new Exception("accepted collection Name");}catch(OfficeFault e){Equal("worksheet_required",e.InputRule);Equal(false,e.InvocationStarted);}
    var invalidNameSteps=new List<OfficeStep>{new OfficeStep{Target="calculation_range",Member="Value2",Action="set",Value=99},new OfficeStep{Target="worksheet_list_collection",Member="Name",Action="set",Value="wrong"}};
    try{session.Prepare(worksheetList.SnapshotId,"잘못된 시트 경로",invalidNameSteps,new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="calculation_range",Member="Value2"},Equals=99}});throw new Exception("accepted collection Name in late step");}catch(OfficeFault e){Equal("worksheet_required",e.InputRule);}
    GetExcelFixtureStats(out _,out int worksheetWritesAfter,out _);Equal(worksheetWritesBefore,worksheetWritesAfter);
    var named=ExcelWorksheets.Prepare(session,Wire.Parse("{name:'실제 시트'}"),true);Equal("verified",session.Apply(named.Id,true,default).Status);
    named=ExcelWorksheets.Prepare(session,Wire.Parse("{sheet:'실제 시트',name:'이름 변경 확인'}"),false);Equal("verified",session.Apply(named.Id,true,default).Status);
    var reboundRead=session.Inspect(new List<OfficeStep>{new OfficeStep{Id="rebinding_collection",Member="Worksheets"},new OfficeStep{Target="rebinding_collection",Member="Count"}});
    var reboundPlan=session.Prepare(reboundRead.SnapshotId,"명시적인 Item 대상 연결",new List<OfficeStep>{new OfficeStep{Id="rebinding_collection",Target="rebinding_collection",Member="Item",Args=new JArray(1)},new OfficeStep{Target="rebinding_collection",Member="Name",Action="set",Value=firstName}},new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="rebinding_collection",Member="Name"},Equals=firstName}});Equal("verified",session.Apply(reboundPlan.Id,true,default).Status);
    var namedList=ExcelWorksheets.Read(session);Equal(worksheetCount+1,namedList.Count);Equal(firstName,namedList.Worksheets[0].Name);Equal("이름 변경 확인",namedList.Worksheets.Last().Name);
    var early=session.Inspect(new List<OfficeStep>{new OfficeStep{Member="Name"}});GetExcelFixtureStats(out _,out int earlyWrites,out _);
    foreach(var bad in new[]{new OfficeStep{Target="date_preflight_range",Member="MissingMember",Action="set",Value=1},new OfficeStep{Target="document",Member="ColumnWidth",Action="set",Value=20}}){
     var reject=new List<OfficeStep>{new OfficeStep{Target="argument_new_sheet",Member="Range",Args=new JArray("A1"),Id="date_preflight_range"},new OfficeStep{Target="date_preflight_range",Member="Value2",Action="set",Value="must not write"},bad};
     try{session.Prepare(early.SnapshotId,"전체 계획 사전 검사",reject,new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="date_preflight_range",Member="Value2"},Equals="must not write"}});throw new Exception("late bad member accepted");}catch(OfficeFault e){Equal("office_member_not_found",e.Message);Equal(false,e.InvocationStarted);}
    }
    GetExcelFixtureStats(out _,out int noEarlyWrites,out _);Equal(earlyWrites,noEarlyWrites);
    var formatted=ExcelCellFormats.Prepare(session,Wire.Parse("{address:'A1',numberFormat:'0.00',bold:true,wrapText:true,columnWidth:20.03,rowHeight:25.1}"),null);var formatReceipt=session.Apply(formatted.Id,true,default);Equal("verified",formatReceipt.Status);Equal(7,formatReceipt.Checks.Count);Equal("0.00",port.Execute(new OfficeStep{Target="format_range",Member="NumberFormat"},true));
    port.Execute(new OfficeStep{Id="date_range",Target="argument_new_sheet",Member="Range",Args=new JArray("A1")},true);var date=Wire.Parse("{value:'2026-10-13T00:00:00Z'}")["value"];port.Execute(new OfficeStep{Target="date_range",Action="set",Member="Value2",Value=date},false);Equal("2026-10-13T00:00:00Z",port.Execute(new OfficeStep{Target="date_range",Member="Value2"},true));
    try{port.Execute(new OfficeStep{Target="date_range",Action="set",Member="Value2",Value=Wire.Parse("{reference:'unknown'}")},false);throw new Exception("accepted unknown argument");}catch(OfficeFault e){Equal("office_argument_invalid",e.Message);Equal(false,e.InvocationStarted);Equal("value",e.InputPath);}
   }
   Marshal.ReleaseComObject(app);app=null;RefusedCopyRegression(source);
   foreach(var host in new[]{"word","powerpoint"}){
    Marshal.ThrowExceptionForHR(CreateExcelFixture(source,out app));
    var content=host=="word"?new DocumentDraft{Title="보고서",Paragraphs=new List<DocumentPart>{new DocumentPart{Style="Title",Text="제목"},new DocumentPart{Style="Normal",Text="본문"}}}:new DocumentDraft{Title="발표",Slides=new List<SlideContent>{new SlideContent{Title="소개",Body=new List<string>{"목표","일정"}},new SlideContent{Title="결론",Body=new List<string>{"다음 단계"}}}};
    using(var creator=new DocumentCreationPort(app,host,12345)){var creation=new DocumentCreation(creator,host,content);var created=creation.Apply(creation.Plan.Id,true,default);if(created.Status!="verified")Console.Error.WriteLine(Wire.Json(created));Equal("verified",created.Status);creator.ActivateCreated();Equal(Wire.Hash(content),Wire.Hash(creator.ReadCreated()));using(var bound=new OfficeAutomationPort(app,host,12345)){Equal(creator.CreatedDocumentId,bound.DocumentId);bound.CheckSource();bound.FocusSource();var audit=new OfficeAutomationSession(bound);var auditBefore=audit.Inspect(new List<OfficeStep>{new OfficeStep{Member="Name"}});var textMember=host=="word"?"Content.Text":"Name";try{audit.Prepare(auditBefore.SnapshotId,"멤버 검사",new List<OfficeStep>{new OfficeStep{Member=textMember,Action="set",Value="must not change"},new OfficeStep{Member="MissingMember",Action="set",Value=1}},new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Member="Name"},Equals="must not change"}});throw new Exception("late host member accepted");}catch(OfficeFault e){Equal(false,e.InvocationStarted);Equal("office_member_not_found",e.Message);}Equal(Wire.Hash(content),Wire.Hash(creator.ReadCreated()));
     if(host=="powerpoint"){var dimensionRead=audit.Inspect(new List<OfficeStep>{new OfficeStep{Id="audit_slides",Member="Slides"},new OfficeStep{Id="audit_slide",Target="audit_slides",Member="Item",Args=new JArray(1)},new OfficeStep{Id="audit_shapes",Target="audit_slide",Member="Shapes"},new OfficeStep{Id="audit_shape",Target="audit_shapes",Member="Item",Args=new JArray(1)},new OfficeStep{Target="audit_shape",Member="TextFrame.TextRange.Font.Size"}});var dimensions=audit.Prepare(dimensionRead.SnapshotId,"폰트 크기 변경",new List<OfficeStep>{new OfficeStep{Target="audit_shape",Member="TextFrame.TextRange.Font.Size",Action="set",Value=18.1}},new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="audit_shape",Member="TextFrame.TextRange.Font.Size"},Equals=18.1}});Equal("verified",audit.Apply(dimensions.Id,true,default).Status);}
     var boldMember=host=="word"?"Content.Font.Bold":"TextFrame.TextRange.Font.Bold";var boldTarget=host=="word"?"document":"audit_shape";foreach(bool desired in new[]{true,false}){var boldBefore=audit.Inspect(new List<OfficeStep>{new OfficeStep{Target=boldTarget,Member=boldMember}});var boldPlan=audit.Prepare(boldBefore.SnapshotId,"폰트 강조 변경",new List<OfficeStep>{new OfficeStep{Target=boldTarget,Member=boldMember,Action="set",Value=desired}},new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target=boldTarget,Member=boldMember},Equals=desired}});Equal(desired?-1:0,(int)boldPlan.Checks[0].Equals);Equal("verified",audit.Apply(boldPlan.Id,true,default).Status);}
     using(var checkpoints=new OfficeFiles(app,host,()=>bound)){var point=Wire.Object(checkpoints.CheckpointNow("검증 전"));Equal(true,(bool)point["encrypted"]);}}}
    GetExcelFixtureStats(out int hostInfo,out _,out _);Equal(0,hostInfo);Marshal.ReleaseComObject(app);app=null;
   }
   File.WriteAllBytes(source,new byte[]{0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1,0,0,0,0});
   Marshal.ThrowExceptionForHR(CreateExcelFixture(source,out app));
   using(var binaryPort=new OfficeAutomationPort(app,"excel",12345))using(var binaryFiles=new OfficeFiles(app,"excel",()=>binaryPort)){
    var binaryCheckpoint=Wire.Object(binaryFiles.CheckpointNow("Excel 97-2003 형식 사본"));Equal(true,(bool)binaryCheckpoint["encrypted"]);Equal(true,binaryFiles.State().Length==64);
   }
   Directory.CreateDirectory("verification");File.WriteAllText("verification/native-dispatch-"+(IntPtr.Size==8?"x64":"x86")+".json",Wire.Json(new{passed=true,architecture=IntPtr.Size==8?"x64":"x86",legacyFailed,legacyException,legacyCode,legacyTypeInfoCalls=legacyInfo,typeInfoCalls=info,valueWrites=writes,checkpointCopies=copies,creationSheets=2,matrixReadback=true,multilineCellReadback=true,raggedRowsPadded=true,refusedCopyAllowsReviewedWrite=true,explicitCheckpointWarning=true,repeatedCheckpointNotRetried=true,newDocumentValuesAndGeneralFormulas=true,activeWorksheetUsedWithoutSelection=true,otherWorksheetPreserved=true,literalFormulaTextPreserved=true,largeIntegerReadback=true,wordCreation=true,powerpointCreation=true,newDocumentIdentity=true,formatMismatchReproduced=true,checkpointFormatMatched=true,wordCheckpoint=true,powerpointCheckpoint=true,omittedItemRejectedBeforeInvocation=true,indexedWorksheetRangePaths=true,missingIndexedSelectorsNotGuessed=true,calculationMethodAndPostRead=true,rangeMergeAndUnmerge=true,referenceArguments=true,isoTextPreserved=true,invalidArgumentsBeforeInvocation=true,countDeltaUsesObservedSheets=true,wrongCountRejectedBeforeWrites=true,countAndCellReadback=true,lateItemRejectedBeforeWrites=true,nativeNumberFormatResolvedAndVerified=true,formatPreservesValuesAndFormulas=true,worksheetCollectionNameRejected=true,lateCollectionNameRejectedBeforeWrites=true,worksheetListAddRenameVerified=true,firstWorksheetPreserved=true,explicitWorksheetRebindingSupported=true,lateUnsupportedMemberBeforeWrites=true,readOnlyPlannedHandlesPreflight=true,scalarHandlesCannotReuseOldObjects=true,setterResultsCannotBeObjectHandles=true,futureIndexedObjectsRemainSupported=true,excelNativeDimensions=true,wordPowerpointPreflight=true,powerpointSinglePrecisionReadback=true,wordPowerpointTriStateReadback=true,automaticNativeTypeChecks=true,propertyPaths=true,propertyCallAliases=true,deniedPathBlocked=true,readMutationBlocked=true,binaryCheckpoint=true,hostAnyCPU=true,coreAnyCPU=true,realOfficeVerified=false}));
   Console.WriteLine("PASS Excel-shaped native COM with TYPE_E_INVDATAREAD: two-sheet creation, SAFEARRAY cell writes/readback, encrypted checkpoints; zero type-info calls. This fixture is not installed Excel.");
  }finally{if(app!=null)Marshal.ReleaseComObject(app);File.Delete(source);}
 }
 sealed class DictionaryPort:IOfficeAutomationPort {readonly object target;readonly int owner=Thread.CurrentThread.ManagedThreadId;public DictionaryPort(object target){this.target=target;}public void CheckSource(){if(owner!=Thread.CurrentThread.ManagedThreadId)throw new OfficeFault("office_thread_required",invocationStarted:false);}public object Execute(OfficeStep step,bool readOnly){CheckSource();OfficeCallPolicy.Validate(step.Member,readOnly,step.Action);var args=step.Args.Select(a=>a.ToObject<object>()).ToList();if(step.Action=="set")args.Add(step.Value.ToObject<object>());return OfficeDispatch.Invoke(target,step.Member,step.Action,args.ToArray());}}
}
