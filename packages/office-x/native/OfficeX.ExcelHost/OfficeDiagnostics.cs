using System;
using System.IO;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 internal static class OfficeDiagnostics {
  static string Member(string value)=>value!=null&&value.Length<=100&&Regex.IsMatch(value,@"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$")?value:null;
  public static object RecordResult(object value,string app,string stage,string tool){
   var result=JToken.Parse(Wire.Json(value)) as JObject;if(result==null)return null;
   var status=(string)result["status"];
   if((bool?)result["ok"]!=false&&status!="failed"&&status!="partial"&&status!="conflict"&&status!="verification_pending")return null;
   string Identifier(string text)=>text!=null&&Regex.IsMatch(text,@"^[A-Za-z_][A-Za-z0-9_]{0,100}$")?text:null;
   var code=Identifier((string)result["error"])??"native_tool_failed";var native=(string)result["nativeCode"];
   var record=new{id=Guid.NewGuid().ToString("N").Substring(0,12),at=DateTime.UtcNow.ToString("o"),app,stage=Identifier(stage),tool=Identifier(tool),code,exception=Identifier((string)result["exceptionName"]),failureStage=Identifier((string)result["failureStage"]),member=Member((string)result["failedMember"]),nativeCode=native!=null&&Regex.IsMatch(native,@"^0x[0-9A-Fa-f]{8}$")?native:null,status,mutated=(bool?)result["mutated"]==true,completedWrites=(int?)result["completedWrites"],version="0.8.3"};
   try{var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"OfficeX","Logs");Directory.CreateDirectory(folder);File.AppendAllText(Path.Combine(folder,"host.jsonl"),Wire.Json(record)+Environment.NewLine);}catch{}
   return record;
  }
  public static object Record(Exception error,string app,string stage){var inner=error.InnerException??error;var id=Guid.NewGuid().ToString("N").Substring(0,12);var fault=error as OfficeFault;var record=new{id,at=DateTime.UtcNow.ToString("o"),app,stage,exception=(error as OfficeFault)?.ExceptionName??inner.GetType().Name,nativeCode=(error as OfficeFault)?.NativeCode??"0x"+unchecked((uint)inner.HResult).ToString("X8"),code=fault?.Message,member=Member(fault?.Member),version="0.8.3"};try{var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"OfficeX","Logs");Directory.CreateDirectory(folder);var path=Path.Combine(folder,"host.jsonl");if(File.Exists(path)&&new FileInfo(path).Length>2*1024*1024){var previous=path+".previous";if(File.Exists(previous))File.Delete(previous);File.Move(path,previous);}File.AppendAllText(path,Wire.Json(record)+Environment.NewLine);}catch{}return record;}
 }
}
