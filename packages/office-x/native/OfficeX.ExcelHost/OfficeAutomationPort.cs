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
 sealed class OfficeAutomationPort:IOfficeAutomationPort,IDisposable {
  readonly int threadId=Thread.CurrentThread.ManagedThreadId;
  readonly dynamic application;readonly string app;readonly int hwnd;readonly string sourceId;
  readonly Dictionary<string,object> objects=new Dictionary<string,object>();readonly List<object> acquired=new List<object>();
  static string Identity(object o){var p=Marshal.GetIUnknownForObject(o);try{return p.ToInt64().ToString();}finally{Marshal.Release(p);}}
  public OfficeAutomationPort(object application,string app,int hwnd){this.application=application;this.app=app;this.hwnd=hwnd;object doc=Source();if(doc==null)throw new OfficeFault("open_document_required");acquired.Add(doc);objects["document"]=doc;sourceId=Identity(doc);}
  public string DocumentId=>sourceId;
  public object BoundDocument=>objects["document"];
  public string DocumentName=>(string)OfficeDispatch.Get(objects["document"],"Name");
  object Source()=>OfficeDispatch.Get((object)application,app=="word"?"ActiveDocument":app=="powerpoint"?"ActivePresentation":"ActiveWorkbook");
  public void CheckSource(){object win=null,doc=null;try{win=OfficeDispatch.Get((object)application,"ActiveWindow");doc=Source();if(win==null||doc==null||Convert.ToInt32(OfficeDispatch.Get(win,"HWND"))!=hwnd||Identity(doc)!=sourceId)throw new OfficeFault("activate_source_window");}finally{Release(win);Release(doc);}}
  static void Release(object o){if(o!=null&&Marshal.IsComObject(o))Marshal.ReleaseComObject(o);}
  object Arg(JToken value){if(value==null||value.Type==JTokenType.Null)return null;if(value is JObject obj){if(obj.Count==1&&obj["ref"]?.Type==JTokenType.String&&objects.TryGetValue((string)obj["ref"],out var reference))return reference;if(obj.Count==1&&(bool?)obj["missing"]==true)return Type.Missing;throw new OfficeFault("office_argument_invalid",invocationStarted:false);}if(value is JArray a){if(a.Count>0&&a.All(x=>x is JArray)){int cols=((JArray)a[0]).Count;if(a.Any(r=>((JArray)r).Count!=cols))throw new OfficeFault("office_argument_invalid",invocationStarted:false);var matrix=new object[a.Count,cols];for(int r=0;r<a.Count;r++)for(int c=0;c<cols;c++)matrix[r,c]=Arg(a[r][c]);return matrix;}return a.Select(Arg).ToArray();}if(value.Type==JTokenType.Integer){long number=value.Value<long>();return number>=int.MinValue&&number<=int.MaxValue?(object)(int)number:(double)number;}if(value.Type==JTokenType.Float)return value.Value<double>();if(value.Type==JTokenType.Boolean)return value.Value<bool>();if(value.Type==JTokenType.String)return value.Value<string>();throw new OfficeFault("office_argument_invalid",invocationStarted:false);}
  public object Execute(OfficeStep step,bool readOnly){
   if(Thread.CurrentThread.ManagedThreadId!=threadId)throw new OfficeFault("office_thread_required");
   OfficeCallPolicy.Validate(step.Member,readOnly,step.Action);
   string targetName=step.Target??"document";object target;
   string[] targetPath=new string[0];
   if(!objects.TryGetValue(targetName,out target)){
    var parts=targetName.Split('.');
    if(parts.Length<2||!objects.TryGetValue(parts[0],out target))throw new OfficeFault("office_target_unknown",step.Member,invocationStarted:false);
    targetPath=parts.Skip(1).ToArray();OfficeCallPolicy.Validate(String.Join(".",targetPath),true,"get");
   }
   // Validate the entire path before any native lookup. Traverse only getters;
   // execute the final requested mutation once, with normal independent readback.
   var memberPath=step.Member.Split('.');
   var args=(step.Args??new JArray()).Select(Arg).ToList();if(step.Action=="set")args.Add(Arg(step.Value));
   target=ResolvePath(target,targetPath.Concat(memberPath.Take(memberPath.Length-1)));
   string member=memberPath.Last();
   if(app=="excel"&&new[]{"Value","Value2","Formula","FormulaLocal","FormulaArray","Text"}.Contains(member,StringComparer.OrdinalIgnoreCase)){
    double size=0;try{size=Convert.ToDouble(OfficeDispatch.Get(target,"CountLarge"));}catch{}
    if(size>20000)throw new OfficeFault("context_limit");
   }
   var result=OfficeDispatch.Invoke(target,member,step.Action,args.ToArray());
   if(result!=null&&Marshal.IsComObject(result)){
    acquired.Add(result);if(string.IsNullOrWhiteSpace(step.Id)||step.Id=="document")throw new OfficeFault("office_object_id_required");
    objects[step.Id]=result;return new{reference=step.Id};
   }
   // Scalar results never become invocation targets; only native COM objects do.
   if(step.Id=="document")throw new OfficeFault("office_object_id_required");
   if(step.Action=="set")return new{applied=true};
   if(result is string text&&text.Length>48000)return new{text=text.Substring(0,48000),truncated=true,length=text.Length};
   if(result is Array array){if(array.Length>20000)throw new OfficeFault("context_limit");if(array.Rank==2){var rows=new List<List<object>>();for(int r=array.GetLowerBound(0);r<=array.GetUpperBound(0);r++){var row=new List<object>();for(int c=array.GetLowerBound(1);c<=array.GetUpperBound(1);c++)row.Add(array.GetValue(r,c));rows.Add(row);}return rows;}}
   return result;
  }
  object ResolvePath(object target,IEnumerable<string> members){foreach(string member in members){object child=OfficeDispatch.Get(target,member);if(child==null||!Marshal.IsComObject(child))throw new OfficeFault("office_member_path_not_supported",member,invocationStarted:false);acquired.Add(child);target=child;}return target;}
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
