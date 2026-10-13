using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
namespace OfficeX.Core {
 public sealed class OfficeStep {public string Id {get;set;} public string Target {get;set;}="document";public string Action {get;set;}="get";public string Member {get;set;} public JArray Args {get;set;}=new JArray();public JToken Value {get;set;}}
 public sealed class OfficeCheck {public OfficeStep Read {get;set;} public new JToken Equals {get;set;}}
 public sealed class OfficeObservation {public string SnapshotId {get;set;} public List<OfficeStep> Steps {get;set;} public List<object> Results {get;set;}}
 public sealed class OfficePlan {public string Kind {get;set;}="office_operations";public string Id {get;set;} public string Summary {get;set;} public OfficeObservation Before {get;set;} public List<OfficeStep> Steps {get;set;} public List<OfficeCheck> Checks {get;set;}}
 public sealed class OfficeExecutionReceipt {public string Kind {get;set;}="office_operations";public string PlanId {get;set;} public string Status {get;set;} public string Error {get;set;} public string FailedMember {get;set;} public string NativeCode {get;set;} public bool Mutated {get;set;} public int CompletedWrites {get;set;} public bool WriteResultUncertain {get;set;} public bool Saved {get;set;} public int Count {get;set;} public List<object> Results {get;set;}=new List<object>();public List<object> Checks {get;set;}=new List<object>();}
 public interface IOfficeAutomationPort {void CheckSource();object Execute(OfficeStep step,bool readOnly);}
 public sealed class OfficeAutomationSession {
  readonly IOfficeAutomationPort port;readonly Dictionary<string,OfficeObservation> observations=new Dictionary<string,OfficeObservation>();readonly Dictionary<string,OfficePlan> plans=new Dictionary<string,OfficePlan>();bool stopped;
  public OfficeAutomationSession(IOfficeAutomationPort port){this.port=port;}
  public OfficeObservation Inspect(List<OfficeStep> steps){ValidateSteps(steps,true);foreach(var step in steps)OfficeCallPolicy.Validate(step.Member,true,step.Action);port.CheckSource();var result=new OfficeObservation{SnapshotId=Guid.NewGuid().ToString("N"),Steps=Wire.Clone(steps),Results=new List<object>()};foreach(var step in steps)result.Results.Add(port.Execute(step,true));if(Wire.Json(result).Length>200000)throw new OfficeFault("context_limit");if(observations.Count>=32)observations.Remove(observations.Keys.First());observations[result.SnapshotId]=Wire.Clone(result);return result;}
  static void ValidateSteps(List<OfficeStep> steps,bool readOnly){if(steps==null||steps.Count<1||steps.Count>1000||steps.Any(s=>s==null||string.IsNullOrEmpty(s.Member)||s.Member.Length>100||!new[]{"get","call","set"}.Contains(s.Action)||(readOnly&&s.Action=="set"))||Wire.Json(steps).Length>200000)throw new OfficeFault("office_steps_invalid");}
  public OfficePlan Prepare(string snapshotId,string summary,List<OfficeStep> steps,List<OfficeCheck> checks){if(stopped)throw new OfficeFault("writes_stopped_for_this_run");if(snapshotId==null||!observations.TryGetValue(snapshotId,out var before))throw new OfficeFault("snapshot_required");ValidateSteps(steps,false);foreach(var step in steps)OfficeCallPolicy.Validate(step.Member,false,step.Action);if(string.IsNullOrWhiteSpace(summary)||summary.Length>2000||checks==null||checks.Count<1||checks.Count>1000||checks.Any(c=>c==null||c.Read==null||c.Equals==null))throw new OfficeFault("office_checks_required");ValidateSteps(checks.Select(c=>c.Read).ToList(),true);foreach(var check in checks)OfficeCallPolicy.Validate(check.Read.Member,true,check.Read.Action);var plan=new OfficePlan{Id=Guid.NewGuid().ToString("N"),Summary=summary,Before=Wire.Clone(before),Steps=Wire.Clone(steps),Checks=Wire.Clone(checks)};plans[plan.Id]=plan;return Wire.Clone(plan);}
  static bool Equivalent(JToken a,JToken b){
   bool Number(JToken t)=>t.Type==JTokenType.Integer||t.Type==JTokenType.Float;
   if(Number(a)&&Number(b))return a.Value<double>()==b.Value<double>();
   if(a is JArray aa&&b is JArray ba)return aa.Count==ba.Count&&aa.Zip(ba,Equivalent).All(v=>v);
   return JToken.DeepEquals(a,b);
  }
  public OfficeExecutionReceipt Apply(string id,bool approved,CancellationToken token)=>ApplyAsync(id,approved,token).GetAwaiter().GetResult();
  public async Task<OfficeExecutionReceipt> ApplyAsync(string id,bool approved,CancellationToken token){if(stopped||id==null||!plans.TryGetValue(id,out var plan))throw new OfficeFault("invalid_plan");plans.Remove(id);var r=new OfficeExecutionReceipt{PlanId=id,Status="rejected"};if(!approved){stopped=true;return r;}
   try{token.ThrowIfCancellationRequested();port.CheckSource();var live=plan.Before.Steps.Select(s=>port.Execute(s,true)).ToList();if(Wire.Hash(live)!=Wire.Hash(plan.Before.Results))throw new OfficeFault("source_changed");
    foreach(var step in plan.Steps){await Task.Yield();token.ThrowIfCancellationRequested();if(step.Action!="get"){r.Mutated=true;r.WriteResultUncertain=true;}r.Results.Add(port.Execute(step,false));r.Count++;if(step.Action!="get"){r.CompletedWrites++;r.WriteResultUncertain=false;}}
    foreach(var check in plan.Checks){await Task.Yield();token.ThrowIfCancellationRequested();var actual=port.Execute(check.Read,true);bool matches=Equivalent(actual==null?JValue.CreateNull():JToken.FromObject(actual),check.Equals);r.Checks.Add(new{read=check.Read,actual,expected=check.Equals,passed=matches});if(!matches)throw new OfficeFault("readback_mismatch");}
    r.Status="verified";observations.Clear();plans.Clear();
   }catch(OperationCanceledException){r.Status=r.Mutated?"partial":"cancelled";r.Error="cancelled";stopped=true;}
   catch(OfficeFault e){if(e.InvocationStarted==false&&r.CompletedWrites==0){r.Mutated=false;r.WriteResultUncertain=false;}r.Status=r.Mutated?"partial":"conflict";r.Error=e.Message;r.FailedMember=e.Member;r.NativeCode=e.NativeCode;stopped=!OfficeCallPolicy.CanReplan(r);}
   catch{r.Status=r.Mutated?"partial":"failed";r.Error="native_execution_failed";stopped=true;}
   return r;
  }
 }
}
