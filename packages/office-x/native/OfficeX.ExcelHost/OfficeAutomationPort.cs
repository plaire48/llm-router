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
  static readonly HashSet<string> ReadCalls=new HashSet<string>(new[]{"Item","Range","Cell","Characters","Paragraphs","Words","Sentences","Rows","Columns","Cells","Runs","FindBySlideID","get_Address","Address","Information","ComputeStatistics","PivotCaches","PivotTables","ChartObjects","SeriesCollection","Axes","SpecialCells","Find","Offset","Resize"},StringComparer.OrdinalIgnoreCase);
  // Office object model capability boundary: no macro execution, add-in loading, shell/DDE or parent/application escape.
  static readonly HashSet<string> Denied=new HashSet<string>(new[]{"GetType","Evaluate","Application","Parent","VBProject","VBE","Run","RunAutoMacros","ExecuteExcel4Macro","DDEInitiate","DDEExecute","DDEPoke","DDERequest","OnTime","OnKey","OnAction","OLEObjects","OLEFormat","AddOLEObject","AddOLEControl","AddFromFile","Open","FollowHyperlink","ExportAsFixedFormat","Save","SaveAs","SaveAs2","SaveCopyAs","Close","Quit"},StringComparer.OrdinalIgnoreCase);
  static string Identity(object o){var p=Marshal.GetIUnknownForObject(o);try{return p.ToInt64().ToString();}finally{Marshal.Release(p);}}
  public OfficeAutomationPort(object application,string app,int hwnd){this.application=application;this.app=app;this.hwnd=hwnd;object doc=Source();acquired.Add(doc);objects["document"]=doc;sourceId=Identity(doc);}
  object Source()=>app=="word"?application.ActiveDocument:app=="powerpoint"?application.ActivePresentation:application.ActiveWorkbook;
  public void CheckSource(){object win=null,doc=null;try{win=application.ActiveWindow;doc=Source();if((int)((dynamic)win).HWND!=hwnd||Identity(doc)!=sourceId)throw new OfficeFault("activate_source_window");}finally{Release(win);Release(doc);}}
  static void Release(object o){if(o!=null&&Marshal.IsComObject(o))Marshal.ReleaseComObject(o);}
  object Arg(JToken value){if(value==null||value.Type==JTokenType.Null)return null;if(value is JObject obj){if(obj.Count==1&&obj["ref"]?.Type==JTokenType.String&&objects.TryGetValue((string)obj["ref"],out var reference))return reference;if(obj.Count==1&&(bool?)obj["missing"]==true)return Type.Missing;throw new OfficeFault("office_argument_invalid");}if(value is JArray a){if(a.Count>0&&a.All(x=>x is JArray)){int cols=((JArray)a[0]).Count;if(a.Any(r=>((JArray)r).Count!=cols))throw new OfficeFault("office_argument_invalid");var matrix=new object[a.Count,cols];for(int r=0;r<a.Count;r++)for(int c=0;c<cols;c++)matrix[r,c]=Arg(a[r][c]);return matrix;}return a.Select(Arg).ToArray();}if(value.Type==JTokenType.Integer)return checked((int)value.Value<long>());if(value.Type==JTokenType.Float)return value.Value<double>();if(value.Type==JTokenType.Boolean)return value.Value<bool>();if(value.Type==JTokenType.String)return value.Value<string>();throw new OfficeFault("office_argument_invalid");}
  public object Execute(OfficeStep step,bool readOnly){
   if(Thread.CurrentThread.ManagedThreadId!=threadId)throw new OfficeFault("office_thread_required");
   if(Denied.Contains(step.Member)||!System.Text.RegularExpressions.Regex.IsMatch(step.Member,@"^[A-Za-z_][A-Za-z0-9_]*$"))throw new OfficeFault("office_member_unavailable");
   if(readOnly&&(step.Action=="set"||step.Action=="call"&&(!ReadCalls.Contains(step.Member)||step.Member.Equals("Evaluate",StringComparison.OrdinalIgnoreCase))))throw new OfficeFault("office_read_requires_get");
   if(!objects.TryGetValue(step.Target??"document",out var target))throw new OfficeFault("office_target_unknown");
   if(app=="excel"&&new[]{"Value","Value2","Formula","FormulaLocal","FormulaArray","Text"}.Contains(step.Member,StringComparer.OrdinalIgnoreCase)){
    double size=0;try{size=Convert.ToDouble(((dynamic)target).CountLarge);}catch{}
    if(size>20000)throw new OfficeFault("context_limit");
   }
   var args=(step.Args??new JArray()).Select(Arg).ToList();var flags=BindingFlags.Public|BindingFlags.Instance|BindingFlags.OptionalParamBinding;
   if(step.Action=="set"){args.Add(Arg(step.Value));flags|=BindingFlags.SetProperty;}
   else flags|=step.Action=="call"?BindingFlags.InvokeMethod:BindingFlags.GetProperty|(ReadCalls.Contains(step.Member)?BindingFlags.InvokeMethod:0);
   object result;
   try{result=target.GetType().InvokeMember(step.Member,flags,null,target,args.ToArray(),System.Globalization.CultureInfo.InvariantCulture);}
   catch(TargetInvocationException e){throw new OfficeFault("office_operation_failed: "+step.Member+": "+(e.InnerException?.Message??e.Message));}
   catch(COMException e){throw new OfficeFault("office_operation_failed: "+step.Member+": "+e.Message);}
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
  public void FocusSource(){
   dynamic doc=objects["document"];
   if(app=="powerpoint"){object windows=null,window=null;try{windows=doc.Windows;window=((dynamic)windows).Item(1);((dynamic)window).Activate();}finally{Release(window);Release(windows);}}
   else doc.Activate();
   CheckSource();
  }
  public object Save(bool pdf,CancellationToken token){
   CheckSource();token.ThrowIfCancellationRequested();dynamic doc=objects["document"];
   bool macros=false;if(!pdf)try{macros=(bool)doc.HasVBProject;}catch{}
   string extension=pdf?"pdf":app=="word"?(macros?"docm":"docx"):app=="powerpoint"?(macros?"pptm":"pptx"):(macros?"xlsm":"xlsx");
   using(var dialog=new SaveFileDialog{Title=pdf?"PDF로 내보내기":"문서 저장",Filter=extension.ToUpperInvariant()+" 문서|*."+extension,DefaultExt=extension,AddExtension=true,OverwritePrompt=true,FileName=Path.GetFileNameWithoutExtension((string)doc.Name)+"."+extension}){
    if(dialog.ShowDialog()!=DialogResult.OK)return new{kind="save_document",status="rejected",saved=false,mutated=false};
    CheckSource();token.ThrowIfCancellationRequested();
    try{
     if(pdf){if(app=="word")doc.ExportAsFixedFormat(dialog.FileName,17);else if(app=="powerpoint")doc.ExportAsFixedFormat(dialog.FileName,2);else doc.ExportAsFixedFormat(0,dialog.FileName);}
     else if(app=="word")doc.SaveAs2(dialog.FileName,macros?13:12);
     else if(app=="powerpoint")doc.SaveAs(dialog.FileName,macros?25:24);
     else doc.SaveAs(dialog.FileName,macros?52:51);
     bool exists=File.Exists(dialog.FileName)&&new FileInfo(dialog.FileName).Length>0;
     bool matches=pdf||String.Equals(Path.GetFullPath((string)doc.FullName),Path.GetFullPath(dialog.FileName),StringComparison.OrdinalIgnoreCase);
     bool saved=pdf||(app=="powerpoint"?Convert.ToInt32(doc.Saved)!=0:(bool)doc.Saved);
     return new{kind="save_document",status=exists&&matches&&saved?"verified":"partial",saved=exists&&matches&&saved,mutated=true,document=Path.GetFileName(dialog.FileName),path=dialog.FileName,pdf};
    }catch{return new{kind="save_document",status="partial",saved=false,mutated=true,document=Path.GetFileName(dialog.FileName),error="save_result_uncertain"};}
   }
  }
  public void Dispose(){for(int i=acquired.Count-1;i>=0;i--)Release(acquired[i]);acquired.Clear();objects.Clear();}
 }
}
