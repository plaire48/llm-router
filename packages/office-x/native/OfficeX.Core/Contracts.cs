using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Newtonsoft.Json.Linq;

namespace OfficeX.Core
{
    public sealed class OfficeFault : Exception {
        public string Member {get;} public string NativeCode {get;} public bool? InvocationStarted {get;} public string ExceptionName {get;}
        public OfficeFault(string code,string member=null,int? nativeCode=null,bool? invocationStarted=null,string exceptionName=null) : base(code) {Member=member;NativeCode=nativeCode.HasValue?"0x"+unchecked((uint)nativeCode.Value).ToString("X8"):null;InvocationStarted=invocationStarted;ExceptionName=exceptionName;}
    }
    public static class Wire
    {
        public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings {
            ContractResolver = new CamelCasePropertyNamesContractResolver(), Culture = CultureInfo.InvariantCulture,
            TypeNameHandling = TypeNameHandling.None, MaxDepth = 32 };
        public static string Json(object value) => JsonConvert.SerializeObject(value, Settings);
        public static JObject Object(object value) => JObject.Parse(Json(value));
        public static T Clone<T>(T value) => JsonConvert.DeserializeObject<T>(Json(value), Settings);
        public static string Hash(object value) {
            using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Json(value)))).Replace("-", "");
        }
    }
    public sealed class Cell
    {
        public string Address { get; set; }
        public object Value { get; set; }
        public string Formula { get; set; }
        public bool Error { get; set; }
        public bool Merged { get; set; }
        public bool ArrayFormula { get; set; }
        public bool Hidden { get; set; }
        public bool Table { get; set; }
        public bool Locked { get; set; }
    }
    public sealed class Snapshot
    {
        public string SnapshotId { get; set; }
        public string DocumentId { get; set; }
        public string WorksheetId { get; set; }
        public string Workbook { get; set; }
        public string Worksheet { get; set; }
        public string Address { get; set; }
        public bool ReadOnly { get; set; }
        public bool Protected { get; set; }
        public bool CalculationDone { get; set; }
        public List<Cell> Cells { get; set; } = new List<Cell>();
        public string Fingerprint() {
            var copy = Wire.Clone(this); copy.SnapshotId = null;
            return Wire.Hash(copy);
        }
    }
    public sealed class FormulaOperation
    {
        public string Address { get; set; }
        public string Formula { get; set; }
    }
    public sealed class ChangePlan
    {
        public string Id { get; set; }
        public Snapshot Before { get; set; }
        public List<FormulaOperation> Operations { get; set; }
    }
    public sealed class CellReceipt
    {
        public string Address { get; set; }
        public string Formula { get; set; }
        public object BeforeValue { get; set; }
        public object ActualValue { get; set; }
        public double ExpectedValue { get; set; }
        public string Status { get; set; }
    }
    public sealed class ApplyReceipt
    {
        public string PlanId { get; set; }
        public string Status { get; set; }
        public string Error { get; set; }
        public bool Mutated { get; set; }
        public bool Saved { get; set; } // No automatic save in the initial toolset.
        public List<CellReceipt> Cells { get; set; } = new List<CellReceipt>();
    }
    public sealed class ExcelReadContext {
        public string Selection {get;set;}
        public string CurrentRegion {get;set;}
        public string UsedRange {get;set;}
        public string SurroundingRange {get;set;}
        public bool Truncated {get;set;}
    }
    public interface IExcelContextPort {ExcelReadContext GetReadContext(Snapshot binding);}
    public interface IExcelPort
    {
        Snapshot CaptureSelection();
        Snapshot Read(Snapshot binding, string address);
        void WriteFormula(Snapshot binding, string address, string formula);
        void Calculate(Snapshot binding);
    }
}
