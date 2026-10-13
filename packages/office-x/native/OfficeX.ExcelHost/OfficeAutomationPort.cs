using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.IO;
using System.Windows.Forms;
using System.Threading;
using System.Runtime.InteropServices;
using Newtonsoft.Json.Linq;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 // Structured Office Object Model calls, never eval, C#, VBA or a shell.
 sealed class OfficeAutomationPort:IOfficeAutomationPort,IOfficePreflightPort,IOfficeBatchPreflightPort,IDisposable {
  readonly int threadId=Thread.CurrentThread.ManagedThreadId;
  readonly dynamic application;readonly string app;readonly int hwnd;readonly string sourceId;
  readonly HashSet<string> worksheetCollections=new HashSet<string>();
  readonly Dictionary<string,object> objects=new Dictionary<string,object>();readonly List<object> acquired=new List<object>();
  static string Identity(object o){var p=Marshal.GetIUnknownForObject(o);try{return p.ToInt64().ToString();}finally{Marshal.Release(p);}}
  public OfficeAutomationPort(object application,string app,int hwnd){this.application=application;this.app=app;this.hwnd=hwnd;object doc=Source();if(doc==null)throw new OfficeFault("open_document_required");acquired.Add(doc);objects["document"]=doc;sourceId=Identity(doc);}
  public string DocumentId=>sourceId;
  public object BoundDocument=>objects["document"];
  public string DocumentName=>(string)OfficeDispatch.Get(objects["document"],"Name");
  object Source()=>OfficeDispatch.Get((object)application,app=="word"?"ActiveDocument":app=="powerpoint"?"ActivePresentation":"ActiveWorkbook");
  public void CheckSource(){object win=null,doc=null;try{win=OfficeDispatch.Get((object)application,"ActiveWindow");doc=Source();if(win==null||doc==null||Convert.ToInt32(OfficeDispatch.Get(win,"HWND"))!=hwnd||Identity(doc)!=sourceId)throw new OfficeFault("activate_source_window");}finally{Release(win);Release(doc);}}
  static void Release(object o){if(o!=null&&Marshal.IsComObject(o))Marshal.ReleaseComObject(o);}
  object Arg(JToken value,string path)=>OfficeArguments.Convert(value,id=>objects.TryGetValue(id,out var found)?found:null,path);
  bool preflightMutation;readonly Dictionary<string,object> preflightObjects=new Dictionary<string,object>();readonly List<object> preflightAcquired=new List<object>();
  public void BeginPreflight(){CheckSource();EndPreflight();foreach(var pair in objects)preflightObjects[pair.Key]=pair.Value;}
  public void EndPreflight(){preflightMutation=false;for(int i=preflightAcquired.Count-1;i>=0;i--)Release(preflightAcquired[i]);preflightAcquired.Clear();preflightObjects.Clear();}
  public void ValidateInput(OfficeStep step,ISet<string> plannedObjects){
   bool priorMutation=preflightMutation;if(OfficeCallPolicy.WritesDocument(step))preflightMutation=true;
   if(app=="excel")ExcelWorksheetPaths.Validate(step,plannedObjects.Contains(step.Target??"document")?null:worksheetCollections,objects.ContainsKey(step.Target??"document")||plannedObjects.Contains(step.Target??"document"));
   if(step.Id=="document")throw new OfficeFault("office_object_id_required",step.Member,invocationStarted:false);
   string target=step.Target??"document";var prefixes=new string[0];
   if(!objects.ContainsKey(target)&&!plannedObjects.Contains(target)){
    var parts=target.Split('.');
    if(parts.Length>=2&&(objects.ContainsKey(parts[0])||plannedObjects.Contains(parts[0])))prefixes=parts.Skip(1).ToArray();
    else if((app=="excel"?new[]{"Worksheets","Sheets","ActiveSheet"}:app=="word"?new[]{"Content","Tables","Sections","Styles"}:new[]{"Slides","PageSetup"}).Contains(parts[0],StringComparer.OrdinalIgnoreCase))prefixes=parts;
    else throw new OfficeFault("office_target_unknown",step.Member,invocationStarted:false);
    OfficeCallPolicy.Validate(String.Join(".",prefixes),true,"get");
   }
   try{OfficeArguments.ValidateInput(step,app,prefixes,id=>objects.ContainsKey(id)||plannedObjects.Contains(id)?new object():null);}catch(OfficeFault e){throw new OfficeFault(e.Message,e.Member??step.Member,e.NativeCode==null?(int?)null:unchecked((int)Convert.ToUInt32(e.NativeCode.Substring(2),16)),false,e.ExceptionName,e.InputPath,e.InputRule);}
   // Resolve existing objects and read-only planned handles before ANY write.
   // Objects returned by future mutations are deferred, never created speculatively.
   string root=objects.ContainsKey(target)||plannedObjects.Contains(target)?target:target.Split('.')[0];
   if(!preflightObjects.TryGetValue(root,out var native)){if(prefixes.Length>0&&root==prefixes[0]&&!plannedObjects.Contains(root))native=preflightObjects["document"];else{if(step.Id!=null)preflightObjects.Remove(step.Id);return;}}
   if((step.Args??new JArray()).DescendantsAndSelf().OfType<JObject>().Any(v=>v["reference"]!=null||v["ref"]!=null)&& (step.Args??new JArray()).DescendantsAndSelf().OfType<JObject>().Any(v=>(v["reference"]??v["ref"]) is JValue id&&!preflightObjects.ContainsKey(Convert.ToString(id.Value)))){if(step.Id!=null)preflightObjects.Remove(step.Id);return;}
   try{
    var args=(step.Args??new JArray()).Select((v,i)=>OfficeArguments.Convert(v,id=>preflightObjects.TryGetValue(id,out var found)?found:null,"args["+i+"]")).ToList();
    native=OfficePath.Resolve(native,prefixes.Concat(step.Member.Split('.').Take(step.Member.Split('.').Length-1)),args,app,(parent,member,selectors)=>{var child=OfficeDispatch.Get(parent,member,selectors);if(child==null||!Marshal.IsComObject(child))throw new OfficeFault("office_member_path_not_supported",member,invocationStarted:false);preflightAcquired.Add(child);return child;});
    OfficeDispatch.RequireMember(native,OfficeCallPolicy.Leaf(step.Member));
    if(!String.IsNullOrWhiteSpace(step.Id)){preflightObjects.Remove(step.Id);if(!OfficeCallPolicy.WritesDocument(step)){var result=OfficeDispatch.Get(native,OfficeCallPolicy.Leaf(step.Member),args.ToArray());if(result!=null&&Marshal.IsComObject(result)){preflightAcquired.Add(result);preflightObjects[step.Id]=result;}}}
   }catch(OfficeFault e){if(priorMutation&&e.NativeCode=="0x8002000B"){if(step.Id!=null)preflightObjects.Remove(step.Id);return;}throw new OfficeFault(e.Message,step.Member,e.NativeCode==null?(int?)null:unchecked((int)Convert.ToUInt32(e.NativeCode.Substring(2),16)),false,e.ExceptionName,e.InputPath,e.InputRule);}

  }
  public object Execute(OfficeStep step,bool readOnly){
   if(Thread.CurrentThread.ManagedThreadId!=threadId)throw new OfficeFault("office_thread_required");
   OfficeCallPolicy.Validate(step.Member,readOnly,step.Action);
   if(app=="excel")ExcelWorksheetPaths.Validate(step,worksheetCollections,objects.ContainsKey(step.Target??"document"));
   string targetName=step.Target??"document";object target;
   string[] targetPath=new string[0];
   if(!objects.TryGetValue(targetName,out target)){
    var parts=targetName.Split('.');
    if(parts.Length>=2&&objects.TryGetValue(parts[0],out target))targetPath=parts.Skip(1).ToArray();
    else if((app=="excel"?new[]{"Worksheets","Sheets","ActiveSheet"}:app=="word"?new[]{"Content","Tables","Sections","Styles"}:new[]{"Slides","PageSetup"}).Contains(parts[0],StringComparer.OrdinalIgnoreCase)){target=objects["document"];targetPath=parts;}
    else throw new OfficeFault("office_target_unknown",step.Member,invocationStarted:false);
    OfficeCallPolicy.Validate(String.Join(".",targetPath),true,"get");
   }
   // Validate the entire path before any native lookup. Traverse only getters;
   // execute the final requested mutation once, with normal independent readback.
   var memberPath=step.Member.Split('.');
   var args=new List<object>();object setValue=null;try{args=(step.Args??new JArray()).Select((v,i)=>Arg(v,"args["+i+"]")).ToList();if(step.Action=="set")setValue=Arg(step.Value,"value");}catch(OfficeFault e){throw new OfficeFault(e.Message,step.Member,invocationStarted:false,inputPath:e.InputPath,inputRule:e.InputRule);}
   target=ResolvePath(target,targetPath.Concat(memberPath.Take(memberPath.Length-1)),args);
   if(step.Action=="set")args.Add(setValue);
   string member=memberPath.Last();
   if(String.Equals(member,"Item",StringComparison.OrdinalIgnoreCase))OfficeArguments.ValidateItem(step.Action=="set"?args.Take(args.Count-1).ToList():args);
   if(app=="excel"&&new[]{"Value","Value2","Formula","FormulaLocal","FormulaArray","Text"}.Contains(member,StringComparer.OrdinalIgnoreCase)){
    double size=0;try{size=Convert.ToDouble(OfficeDispatch.Get(target,"CountLarge"));}catch{}
    if(size>20000)throw new OfficeFault("context_limit");
   }
   object result;
   try{result=OfficeDispatch.Invoke(target,member,step.Action,args.ToArray());}
   catch(OfficeFault e)when(memberPath.Length>1){throw new OfficeFault(e.Message,step.Member,e.NativeCode==null?(int?)null:unchecked((int)Convert.ToUInt32(e.NativeCode.Substring(2),16)),e.InvocationStarted,e.ExceptionName);}

   if(result!=null&&Marshal.IsComObject(result)){
    acquired.Add(result);if(string.IsNullOrWhiteSpace(step.Id)||step.Id=="document")throw new OfficeFault("office_object_id_required");
    objects[step.Id]=result;if(app=="excel"){if(ExcelWorksheetPaths.IsCollectionMember(member))worksheetCollections.Add(step.Id);else worksheetCollections.Remove(step.Id);}return new{reference=step.Id};
   }
   // Scalar results never become invocation targets; only native COM objects do.
   if(step.Id=="document")throw new OfficeFault("office_object_id_required");
   if(step.Action=="set")return new{applied=true};
   if(result is string text&&text.Length>48000)return new{text=text.Substring(0,48000),truncated=true,length=text.Length};
   if(result is Array array){if(array.Length>20000)throw new OfficeFault("context_limit");if(array.Rank==2){var rows=new List<List<object>>();for(int r=array.GetLowerBound(0);r<=array.GetUpperBound(0);r++){var row=new List<object>();for(int c=array.GetLowerBound(1);c<=array.GetUpperBound(1);c++)row.Add(array.GetValue(r,c));rows.Add(row);}return rows;}}
   return result;
  }
  object ResolvePath(object target,IEnumerable<string> members,List<object> args=null)=>OfficePath.Resolve(target,members,args??new List<object>(),app,(parent,member,selectors)=>{object child=OfficeDispatch.Get(parent,member,selectors);if(child==null||!Marshal.IsComObject(child))throw new OfficeFault("office_member_path_not_supported",member,invocationStarted:false);acquired.Add(child);return child;});
  public object Calculate(string targetName,CancellationToken token){
   if(app!="excel")throw new OfficeFault("excel_required",invocationStarted:false);
   if(Thread.CurrentThread.ManagedThreadId!=threadId)throw new OfficeFault("office_thread_required",invocationStarted:false);
   CheckSource();token.ThrowIfCancellationRequested();object target;
   if(String.IsNullOrEmpty(targetName)||targetName=="document")target=ResolvePath(objects["document"],new[]{"ActiveSheet"});
   else if(!objects.TryGetValue(targetName,out target))throw new OfficeFault("office_target_unknown","Calculate",invocationStarted:false);
   // Range / Worksheet calculation only; no Application-wide execution.
   OfficeDispatch.Call(target,"Calculate");
   int state=Convert.ToInt32(OfficeDispatch.Get((object)application,"CalculationState"));
   return new{status=state==0?"calculated":"verification_pending",calculationDone=state==0,mutated=false,scope="bound document target"};
  }
  public object Members(string target,string query,int count){CheckSource();if(!objects.TryGetValue(target??"document",out var value))throw new OfficeFault("office_target_unknown",invocationStarted:false);return OfficeMembers.Read(value,query,count);}
  public void FocusSource(){
   dynamic doc=objects["document"];
   if(app=="powerpoint"){object windows=null,window=null;try{windows=OfficeDispatch.Get(objects["document"],"Windows");window=OfficeDispatch.Get(windows,"Item",1);OfficeDispatch.Call(window,"Activate");}finally{Release(window);Release(windows);}}
   else OfficeDispatch.Call(objects["document"],"Activate");
   CheckSource();
  }
  public object Save(bool pdf,CancellationToken token){
   CheckSource();token.ThrowIfCancellationRequested();object doc=objects["document"];
   bool macros=false;if(!pdf)try{macros=Convert.ToBoolean(OfficeDispatch.Get(doc,"HasVBProject"));}catch{}
   string extension=pdf?"pdf":app=="word"?(macros?"docm":"docx"):app=="powerpoint"?(macros?"pptm":"pptx"):(macros?"xlsm":"xlsx");
   using(var dialog=new SaveFileDialog{Title=pdf?"PDF로 내보내기":"문서 저장",Filter=extension.ToUpperInvariant()+" 문서|*."+extension,DefaultExt=extension,AddExtension=true,OverwritePrompt=true,FileName=Path.GetFileNameWithoutExtension(Convert.ToString(OfficeDispatch.Get(doc,"Name")))+"."+extension}){
    if(dialog.ShowDialog()!=DialogResult.OK)return new{kind="save_document",status="rejected",saved=false,mutated=false};
    CheckSource();token.ThrowIfCancellationRequested();
    try{
     if(pdf){if(app=="word")OfficeDispatch.Call(doc,"ExportAsFixedFormat",dialog.FileName,17);else if(app=="powerpoint")OfficeDispatch.Call(doc,"ExportAsFixedFormat",dialog.FileName,2);else OfficeDispatch.Call(doc,"ExportAsFixedFormat",0,dialog.FileName);}
     else if(app=="word")OfficeDispatch.Call(doc,"SaveAs2",dialog.FileName,macros?13:12);
     else if(app=="powerpoint")OfficeDispatch.Call(doc,"SaveAs",dialog.FileName,macros?25:24);
     else OfficeDispatch.Call(doc,"SaveAs",dialog.FileName,macros?52:51);
     bool exists=File.Exists(dialog.FileName)&&new FileInfo(dialog.FileName).Length>0;
     bool matches=pdf||String.Equals(Path.GetFullPath(Convert.ToString(OfficeDispatch.Get(doc,"FullName"))),Path.GetFullPath(dialog.FileName),StringComparison.OrdinalIgnoreCase);
     bool saved=pdf||(app=="powerpoint"?Convert.ToInt32(OfficeDispatch.Get(doc,"Saved"))!=0:Convert.ToBoolean(OfficeDispatch.Get(doc,"Saved")));
     return new{kind="save_document",status=exists&&matches&&saved?"verified":"partial",saved=exists&&matches&&saved,mutated=true,document=Path.GetFileName(dialog.FileName),path=dialog.FileName,pdf};
    }catch{return new{kind="save_document",status="partial",saved=false,mutated=true,document=Path.GetFileName(dialog.FileName),error="save_result_uncertain"};}
   }
  }
  public void Dispose(){for(int i=acquired.Count-1;i>=0;i--)Release(acquired[i]);acquired.Clear();objects.Clear();}
 }
}
