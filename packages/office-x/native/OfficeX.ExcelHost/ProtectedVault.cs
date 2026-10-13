using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;
namespace OfficeX.ExcelHost
{
    // Office X owns this store. Never consult Workspace, browser or CLI auth stores.
    internal static class ProtectedVault
    {
        private static readonly string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"OfficeX","Connections");
        private static readonly byte[] Entropy=Encoding.UTF8.GetBytes("OfficeX.Connections.v1");
        private static string FileFor(string key) {
            if(key!="services"&&key!="provider:active"&&key!="provider:aipro"&&key!="provider:chatgpt"&&key!="provider:fabrix"&&key!="provider:claude")throw new InvalidOperationException();
            return Path.Combine(Root,key.Replace(':','-')+".bin");
        }
        public static void Write(string key,JToken value) {
            var path=FileFor(key);Directory.CreateDirectory(Root);
            if(value==null||value.Type==JTokenType.Null){if(File.Exists(path))File.Delete(path);return;}
            byte[] plain=Encoding.UTF8.GetBytes(value.ToString(Newtonsoft.Json.Formatting.None));
            if(plain.Length>128*1024)throw new InvalidOperationException();
            try {
                byte[] encrypted=ProtectedData.Protect(plain,Entropy,DataProtectionScope.CurrentUser);
                string temporary=path+"."+Guid.NewGuid().ToString("N")+".tmp";
                try {File.WriteAllBytes(temporary,encrypted);if(File.Exists(path))File.Replace(temporary,path,null);else File.Move(temporary,path);}
                finally {if(File.Exists(temporary))File.Delete(temporary);}
            }finally{Array.Clear(plain,0,plain.Length);}
        }
        public static JToken Read(string key) {
            var path=FileFor(key);if(!File.Exists(path))return null;
            if(new FileInfo(path).Length>256*1024)throw new InvalidOperationException();
            byte[] plain=ProtectedData.Unprotect(File.ReadAllBytes(path),Entropy,DataProtectionScope.CurrentUser);
            try{return JToken.Parse(Encoding.UTF8.GetString(plain));}finally{Array.Clear(plain,0,plain.Length);}
        }
    }
}
