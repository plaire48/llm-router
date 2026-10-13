using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using OfficeX.ExcelHost;
class Program {
 static int Main(){try{var line=Console.ReadLine();if(line==null||line.Length>256*1024)return 2;var input=JObject.Parse(line);var key=(string)input["key"];if((string)input["method"]=="read")Console.WriteLine(JsonConvert.SerializeObject(new {ok=true,value=ProtectedVault.Read(key)}));else if((string)input["method"]=="write"){ProtectedVault.Write(key,input["value"]);Console.WriteLine("{\"ok\":true}");}else return 2;return 0;}catch{Console.WriteLine("{\"ok\":false,\"error\":\"account_storage_failed\"}");return 1;}}
}
