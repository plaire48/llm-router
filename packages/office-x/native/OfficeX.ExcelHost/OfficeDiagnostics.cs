using System;
using System.IO;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 internal static class OfficeDiagnostics {
  public static object Record(Exception error,string app,string stage){var inner=error.InnerException??error;var id=Guid.NewGuid().ToString("N").Substring(0,12);var fault=error as OfficeFault;var record=new{id,at=DateTime.UtcNow.ToString("o"),app,stage,exception=inner.GetType().Name,nativeCode=(error as OfficeFault)?.NativeCode??"0x"+unchecked((uint)inner.HResult).ToString("X8"),code=fault?.Message,member=fault?.Member,version="0.8.0"};try{var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"OfficeX","Logs");Directory.CreateDirectory(folder);var path=Path.Combine(folder,"host.jsonl");if(File.Exists(path)&&new FileInfo(path).Length>2*1024*1024){var previous=path+".previous";if(File.Exists(previous))File.Delete(previous);File.Move(path,previous);}File.AppendAllText(path,Wire.Json(record)+Environment.NewLine);}catch{}return record;}
 }
}
