using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
namespace OfficeX.Core {
 // Expectations come from reviewed intent and observed originals, never from
 // the post-write value. Do not guess how arbitrary Office methods affect Count.
 public static class OfficeCountChecks {
  static bool Count(OfficeStep s)=>String.Equals(OfficeCallPolicy.Leaf(s.Member),"Count",StringComparison.OrdinalIgnoreCase);
  static bool SameRead(OfficeStep a,OfficeStep b)=>a.Target==b.Target&&String.Equals(a.Member,b.Member,StringComparison.OrdinalIgnoreCase)&&Wire.Json(a.Args??new JArray())==Wire.Json(b.Args??new JArray());
  static bool Integer(JToken t)=>t!=null&&(t.Type==JTokenType.Integer||t.Type==JTokenType.Float)&&!Double.IsNaN(t.Value<double>())&&!Double.IsInfinity(t.Value<double>())&&t.Value<double>()>=0&&t.Value<double>()<=Int32.MaxValue&&t.Value<double>()==Math.Truncate(t.Value<double>());
  public static List<OfficeCheck> Prepare(OfficeObservation before,List<OfficeStep> steps,List<OfficeCheck> requested){
   var checks=Wire.Clone(requested);
   for(int i=0;i<checks.Count;i++){
    var check=checks[i];if(!Count(check.Read)){if(check.Delta!=null)Fail(i,"delta","count_only_delta");continue;}
    if(check.Equals?.Type==JTokenType.Null)check.Equals=null;
    if(check.Delta!=null&&check.Equals!=null)Fail(i,"delta","count_equals_or_delta");
    int at=before.Steps.FindIndex(s=>SameRead(s,check.Read));
    var baseline=at<0?null:JToken.FromObject(before.Results[at]??JValue.CreateNull());
    if(check.Delta!=null){
     if(!Integer(baseline))Fail(i,"delta","observed_count_required");
     double wanted=baseline.Value<double>()+check.Delta.Value;
     if(wanted<0||wanted>Int32.MaxValue)Fail(i,"delta","count_result_out_of_range");
     check.Equals=new JValue((int)wanted);check.Delta=null;
    }
    if(!Integer(check.Equals))Fail(i,"equals","count_integer_required");
    // Excel worksheet collections: setters cannot add/remove worksheets.
    // Direct Worksheets.Add may add Count worksheets (third optional arg).
    // All other mutating methods defer to actual post-write verification.
    bool sheets=before.Steps.Any(s=>s.Id==check.Read.Target&&s.Target=="document"&&new[]{"Worksheets","Sheets"}.Contains(s.Member,StringComparer.OrdinalIgnoreCase));
    if(!sheets||!Integer(baseline)||!String.Equals(check.Read.Member,"Count",StringComparison.OrdinalIgnoreCase))continue;
    long change=0;bool known=true;
    foreach(var step in steps.Where(OfficeCallPolicy.WritesDocument)){
     if(step.Action=="set")continue;
     if(step.Target!=check.Read.Target||!String.Equals(step.Member,"Add",StringComparison.OrdinalIgnoreCase)){known=false;break;}
     var sheetType=step.Args?.Count>3?step.Args[3]:null;
     if(sheetType!=null&&!(sheetType is JObject typeMissing&&typeMissing.Count==1&&(bool?)typeMissing["missing"]==true)&&!(sheetType.Type==JTokenType.Integer&&sheetType.Value<int>()==-4167)){known=false;break;}
     var amount=step.Args?.Count>2?step.Args[2]:null;
     bool missing=amount==null||amount is JObject obj&&obj.Count==1&&(bool?)obj["missing"]==true;
     if(!missing&&(!Integer(amount)||amount.Value<double>()<1)){known=false;break;}
     change+=missing?1:amount.Value<int>();
    }
    // A reassigned collection handle can change what the check reads.
    if(steps.Any(s=>s.Id==check.Read.Target))known=false;
    if(known&&baseline.Value<double>()+change!=check.Equals.Value<double>())Fail(i,"equals","observed_count_plus_sheet_additions");
   }
   return checks;
  }
  static void Fail(int i,string field,string rule){throw new OfficeFault("office_count_expectation_invalid","Count",invocationStarted:false,inputPath:"checks["+i+"]."+field,inputRule:rule);}
 }
}
