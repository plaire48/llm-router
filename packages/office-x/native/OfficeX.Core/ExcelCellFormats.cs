using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
namespace OfficeX.Core {
 public static class ExcelCellFormats {
  static readonly Dictionary<string,string> Members=new Dictionary<string,string>{{"numberFormat","NumberFormat"},{"bold","Font.Bold"},{"wrapText","WrapText"},{"columnWidth","ColumnWidth"},{"rowHeight","RowHeight"}};
  public static OfficePlan Prepare(OfficeAutomationSession session,JObject input,string defaultSheet){
   var requested=Members.Keys.Where(k=>input[k]!=null).ToList();
   if(requested.Count==0)throw new OfficeFault("cell_format_invalid",invocationStarted:false,inputRule:"format_property_required");
   foreach(string key in requested){var value=input[key];if(key=="columnWidth"||key=="rowHeight"){OfficeGeometry.ValidateInput(new OfficeStep{Action="set",Member=Members[key],Value=value},"excel");continue;}bool valid=key=="numberFormat"?value.Type==JTokenType.String&&!String.IsNullOrWhiteSpace((string)value)&&((string)value).Length<=200&&!((string)value).Any(Char.IsControl):value.Type==JTokenType.Boolean;
    if(!valid)throw new OfficeFault("cell_format_invalid",invocationStarted:false,inputPath:key,inputRule:key=="numberFormat"?"number_format_string_required":"boolean_required");}
   string address=(string)input["address"],sheet=(string)input["sheet"]??defaultSheet;
   var reads=ExcelRangeTools.ReadSteps(sheet,address,"format");
   foreach(string key in requested)reads.Add(new OfficeStep{Target="format_range",Member=Members[key]});
   var before=session.Inspect(reads);var steps=new List<OfficeStep>();var checks=new List<OfficeCheck>();
   foreach(string key in requested){var value=input[key].DeepClone();if(key=="numberFormat"&&String.Equals((string)value,"General",StringComparison.OrdinalIgnoreCase))value=new JValue("General");steps.Add(new OfficeStep{Target="format_range",Action="set",Member=Members[key],Value=value});checks.Add(new OfficeCheck{Read=new OfficeStep{Target="format_range",Member=Members[key]},Equals=value,Compare=key=="columnWidth"||key=="rowHeight"?"excel_dimension":null});}
   // Formatting must not silently replace the observed values or formulas.
   foreach(int index in new[]{3,4})checks.Add(new OfficeCheck{Read=reads[index],Equals=before.Results[index]==null?JValue.CreateNull():JToken.FromObject(before.Results[index])});
   return session.Prepare(before.SnapshotId,(string)input["summary"]??(address+(requested.Contains("columnWidth")||requested.Contains("rowHeight")?"에 걸친 열 너비와 행 높이 및 요청한 서식을 변경합니다.":" 셀 서식을 변경합니다.")),steps,checks);
  }
 }
}
