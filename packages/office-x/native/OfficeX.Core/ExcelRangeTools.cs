using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
namespace OfficeX.Core {
 public static class ExcelRangeTools {
  public static List<OfficeStep> ReadSteps(string sheet,string address,string prefix){
   Region region;try{region=Region.Parse(address);}catch{throw new OfficeFault("cell_address_invalid",invocationStarted:false);}
   if(region.Rows>101||region.Columns>20)throw new OfficeFault("context_limit",invocationStarted:false);
   string s=prefix+"_sheet",r=prefix+"_range";
   var reads=sheet==null?new List<OfficeStep>{new OfficeStep{Id=s,Member="ActiveSheet"},new OfficeStep{Target=s,Member="Name"}}:new List<OfficeStep>{new OfficeStep{Id=prefix+"_sheets",Member="Worksheets"},new OfficeStep{Id=s,Target=prefix+"_sheets",Member="Item",Args=new JArray(sheet)}};
   reads.Add(new OfficeStep{Id=r,Target=s,Member="Range",Args=new JArray(region.Address)});
   reads.Add(new OfficeStep{Target=r,Member="Value2"});reads.Add(new OfficeStep{Target=r,Member="Formula"});return reads;
  }
  public static OfficePlan PrepareMerge(OfficeAutomationSession session,JObject input,string defaultSheet){
   string address=(string)input["address"];var reads=ReadSteps((string)input["sheet"]??defaultSheet,address,"merge");var region=Region.Parse(address);
   if(region.Rows*region.Columns<2)throw new OfficeFault("merge_range_required",invocationStarted:false);
   bool unmerge=(bool?)input["unmerge"]??false;string top=Region.CellAddress(region.Row,region.Column);
   reads.Add(new OfficeStep{Target="merge_range",Member="MergeCells"});reads.Add(new OfficeStep{Id="merge_top",Target="merge_sheet",Member="Range",Args=new JArray(top)});reads.Add(new OfficeStep{Target="merge_top",Member="Value2"});reads.Add(new OfficeStep{Target="merge_top",Member="Formula"});
   var before=session.Inspect(reads);
   if(!unmerge){var values=before.Results[3]==null?JValue.CreateNull():JToken.FromObject(before.Results[3]);var formulas=before.Results[4]==null?JValue.CreateNull():JToken.FromObject(before.Results[4]);
    bool ContainsOther(JToken token){if(!(token is JArray rows))return false;for(int r=0;r<rows.Count;r++){if(!(rows[r] is JArray row))throw new OfficeFault("merge_content_unavailable",invocationStarted:false);for(int c=0;c<row.Count;c++)if((r!=0||c!=0)&&row[c].Type!=JTokenType.Null&&!(row[c].Type==JTokenType.String&&(string)row[c]==""))return true;}return false;}
    if(ContainsOther(values)||ContainsOther(formulas))throw new OfficeFault("merge_would_discard_content",invocationStarted:false,inputRule:"preserve_other_cells_before_merge");
   }
   var steps=new List<OfficeStep>{new OfficeStep{Target="merge_range",Action="call",Member=unmerge?"UnMerge":"Merge",Args=unmerge?new JArray():new JArray(false)}};
   var checks=new List<OfficeCheck>{new OfficeCheck{Read=new OfficeStep{Target="merge_range",Member="MergeCells"},Equals=!unmerge},new OfficeCheck{Read=new OfficeStep{Target="merge_top",Member="Value2"},Equals=before.Results[7]==null?JValue.CreateNull():JToken.FromObject(before.Results[7])},new OfficeCheck{Read=new OfficeStep{Target="merge_top",Member="Formula"},Equals=before.Results[8]==null?JValue.CreateNull():JToken.FromObject(before.Results[8])}};
   return session.Prepare(before.SnapshotId,(string)input["summary"]??(address+(unmerge?" 셀 병합을 해제합니다.":" 셀을 병합합니다.")),steps,checks);
  }
 }
}
