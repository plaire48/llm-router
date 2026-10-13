using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
namespace OfficeX.Core {
 // Turn simple cell requests into the same reviewed Office batch as advanced
 // edits. Read the exact cells and their formats first; selection is not scope.
 public static class ExcelCellWrites {
  public static OfficePlan Prepare(OfficeAutomationSession session,JObject input,string defaultSheet){
   var operations=input["operations"] as JArray;if(operations==null||operations.Count<1||operations.Count>100)throw new OfficeFault("cell_operations_invalid",invocationStarted:false);
   var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var addresses=new List<string>();
   foreach(var item in operations){if(!(item is JObject op))throw new OfficeFault("cell_operations_invalid",invocationStarted:false);string address=(string)op["address"];Region region;try{region=Region.Parse(address);}catch{throw new OfficeFault("cell_address_invalid",invocationStarted:false);}if(region.Rows!=1||region.Columns!=1||!seen.Add(region.Address))throw new OfficeFault("cell_address_invalid",invocationStarted:false);addresses.Add(region.Address);
    bool formula=op.Property("formula")!=null,value=op.Property("value")!=null;if(formula==value)throw new OfficeFault("cell_value_or_formula_required",invocationStarted:false);
    if(formula){if(op["formula"].Type!=JTokenType.String||!((string)op["formula"]).StartsWith("=")||((string)op["formula"]).Length>8192)throw new OfficeFault("cell_formula_invalid",invocationStarted:false);}
    else{var v=op["value"];if(!new[]{JTokenType.String,JTokenType.Integer,JTokenType.Float,JTokenType.Boolean,JTokenType.Null}.Contains(v.Type)||v.Type==JTokenType.String&&(((string)v).Length>32000||((string)v).Contains("\0"))||v.Type==JTokenType.Float&&(double.IsNaN((double)v)||double.IsInfinity((double)v)))throw new OfficeFault("cell_value_invalid",invocationStarted:false);}
   }
   string sheet=(string)input["sheet"]??defaultSheet;
   var reads=sheet==null?new List<OfficeStep>{new OfficeStep{Id="cell_sheet",Member="ActiveSheet"},new OfficeStep{Target="cell_sheet",Member="Name"}}:new List<OfficeStep>{new OfficeStep{Id="cell_sheets",Member="Worksheets"},new OfficeStep{Id="cell_sheet",Target="cell_sheets",Member="Item",Args=new JArray(sheet)}};
   for(int i=0;i<operations.Count;i++){string id="cell_"+i;reads.Add(new OfficeStep{Id=id,Target="cell_sheet",Member="Range",Args=new JArray(addresses[i])});foreach(var member in new[]{"Value2","Formula","NumberFormat"})reads.Add(new OfficeStep{Target=id,Member=member});}
   var before=session.Inspect(reads);var steps=new List<OfficeStep>();var checks=new List<OfficeCheck>();
   for(int i=0;i<operations.Count;i++){var op=(JObject)operations[i];string id="cell_"+i;
    if(op.Property("formula")!=null){steps.Add(new OfficeStep{Target=id,Action="set",Member="Formula",Value=op["formula"].DeepClone()});checks.Add(new OfficeCheck{Read=new OfficeStep{Target=id,Member="Formula"},Equals=op["formula"].DeepClone(),Compare="excel_formula"});checks.Add(new OfficeCheck{Read=new OfficeStep{Target=id,Member="HasFormula"},Equals=true});}
    else{var value=op["value"].DeepClone();JToken format=null;if(value.Type==JTokenType.String){var original=before.Results[5+i*4];if(!(original is string))throw new OfficeFault("cell_format_unavailable",invocationStarted:false);format=JToken.FromObject(original);steps.Add(new OfficeStep{Target=id,Action="set",Member="NumberFormat",Value="@"});}
     steps.Add(new OfficeStep{Target=id,Action="set",Member="Value2",Value=value});if(format!=null){steps.Add(new OfficeStep{Target=id,Action="set",Member="NumberFormat",Value=format});checks.Add(new OfficeCheck{Read=new OfficeStep{Target=id,Member="NumberFormat"},Equals=format});}
     checks.Add(new OfficeCheck{Read=new OfficeStep{Target=id,Member="Value2"},Equals=value});checks.Add(new OfficeCheck{Read=new OfficeStep{Target=id,Member="HasFormula"},Equals=false});
    }
   }
   string summary=(string)input["summary"];if(string.IsNullOrWhiteSpace(summary))summary=operations.Count+"개 셀에 값과 수식을 입력합니다.";
   return session.Prepare(before.SnapshotId,summary,steps,checks);
  }
 }
}
