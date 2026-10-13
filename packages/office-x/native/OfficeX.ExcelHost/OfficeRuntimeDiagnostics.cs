using System;
using System.IO;
using System.Threading;
using Newtonsoft.Json.Linq;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 // Only used by the explicit Test-OfficeRuntime.ps1 command on disposable documents.
 public static class OfficeRuntimeDiagnostics {
  public static object CheckFeatures(object application,string app,int windowHandle){using(new OfficeCulture())using(var port=new OfficeAutomationPort(application,app,windowHandle))using(var files=new OfficeFiles(application,app,()=>port)){
   dynamic host=application;object restored=null;
   try{var snapshot=JObject.FromObject(files.CheckpointNow("네이티브 검사 원본"));object rendering=app=="powerpoint"?files.RenderSlides(1,1,640,CancellationToken.None):files.ExportPdf(CancellationToken.None);
    dynamic doc=port.BoundDocument;
    if(app=="word")doc.Content.Text="Changed after snapshot\r";else if(app=="excel")doc.Worksheets.Item(1).Range["A1"].Value2="Changed after snapshot";else doc.Slides.Item(1).Shapes.Item(1).TextFrame.TextRange.Text="Changed after snapshot";
    var result=JObject.FromObject(files.Restore((string)snapshot["id"],CancellationToken.None));restored=app=="word"?host.ActiveDocument:app=="powerpoint"?host.ActivePresentation:host.ActiveWorkbook;
    if((string)result["status"]!="verified")throw new OfficeFault("rollback_readback_failed");return new{checkpoint=snapshot,rendering,rollback=result};
   }finally{if(restored!=null){try{if(app=="powerpoint"){((dynamic)restored).Saved=-1;((dynamic)restored).Close();}else ((dynamic)restored).Close(false);}finally{if(System.Runtime.InteropServices.Marshal.IsComObject(restored))System.Runtime.InteropServices.Marshal.ReleaseComObject(restored);}}try{Directory.Delete(files.Folder,true);}catch{}}
  }}
 }
}
