using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
namespace OfficeX.Core {
 public sealed class OfficeStep {public string Id {get;set;} public string Target {get;set;}="document";public string Action {get;set;}="get";public string Member {get;set;} public JArray Args {get;set;}=new JArray();public JToken Value {get;set;}}
 public sealed class OfficeCheck {public OfficeStep Read {get;set;} public new JToken Equals {get;set;} public string Compare {get;set;} public int? Delta {get;set;}}
 public sealed class OfficeObservation {public string SnapshotId {get;set;} public List<OfficeStep> Steps {get;set;} public List<object> Results {get;set;}}
 public sealed class OfficePlan {public string Kind {get;set;}="office_operations";public string Id {get;set;} public string Summary {get;set;} public OfficeObservation Before {get;set;} public List<OfficeStep> Steps {get;set;} public List<OfficeCheck> Checks {get;set;}}
 public sealed class OfficeExecutionReceipt {public string Kind {get;set;}="office_operations";public string PlanId {get;set;} public string Status {get;set;} public string Error {get;set;} public string FailedMember {get;set;} public string NativeCode {get;set;} public string ExceptionName {get;set;} public string FailureStage {get;set;} public string InputPath {get;set;} public string InputRule {get;set;} public bool? InvocationStarted {get;set;} public bool Mutated {get;set;} public int CompletedWrites {get;set;} public bool WriteResultUncertain {get;set;} public bool Saved {get;set;} public int Count {get;set;} public List<object> Results {get;set;}=new List<object>();public List<object> Checks {get;set;}=new List<object>();}
 public interface IOfficeAutomationPort {void CheckSource();object Execute(OfficeStep step,bool readOnly);}
 public interface IOfficePreflightPort {void ValidateInput(OfficeStep step,ISet<string> plannedObjects);}
 public sealed class OfficeAutomationSession {
  readonly IOfficeAutomationPort port;readonly Dictionary<string,OfficeObservation> observations=new Dictionary<string,OfficeObservation>();readonly Dictionary<string,OfficePlan> plans=new Dictionary<string,OfficePlan>();bool stopped;
  public OfficeAutomationSession(IOfficeAutomationPort port){this.port=port;}
  public OfficeObservation Inspect(List<OfficeStep> steps){ValidateSteps(steps,true);foreach(var step in steps)OfficeCallPolicy.Validate(step.Member,true,step.Action);port.CheckSource();var result=new OfficeObservation{SnapshotId=Guid.NewGuid().ToString("N"),Steps=Wire.Clone(steps),Results=new List<object>()};foreach(var step in steps)result.Results.Add(port.Execute(step,true));if(Wire.Json(result).Length>200000)throw new OfficeFault("context_limit");if(observations.Count>=32)observations.Remove(observations.Keys.First());observations[result.SnapshotId]=Wire.Clone(result);return result;}
  static void ValidateSteps(List<OfficeStep> steps,bool readOnly){if(steps==null||steps.Count<1||steps.Count>1000||steps.Any(s=>s==null||string.IsNullOrEmpty(s.Member)||s.Member.Length>100||!new[]{"get","call","set"}.Contains(s.Action)||(readOnly&&s.Action=="set"))||Wire.Json(steps).Length>200000)throw new OfficeFault("office_steps_invalid");}
  public OfficePlan Prepare(string snapshotId,string summary,List<OfficeStep> steps,List<OfficeCheck> checks){if(stopped)throw new OfficeFault("writes_stopped_for_this_run");if(snapshotId==null||!observations.TryGetValue(snapshotId,out var before))throw new OfficeFault("snapshot_required",invocationStarted:false);ValidateSteps(steps,false);foreach(var step in steps)OfficeCallPolicy.Validate(step.Member,false,step.Action);if(string.IsNullOrWhiteSpace(summary)||summary.Length>2000||checks==null||checks.Count<1||checks.Count>1000||checks.Any(c=>c==null||c.Read==null||c.Equals==null&&c.Delta==null))throw new OfficeFault("office_checks_required");ValidateSteps(checks.Select(c=>c.Read).ToList(),true);foreach(var check in checks){OfficeCallPolicy.Validate(check.Read.Member,true,check.Read.Action);if(check.Compare!=null&&(check.Compare!="excel_formula"||!new[]{"Formula","FormulaLocal"}.Contains(OfficeCallPolicy.Leaf(check.Read.Member))||check.Equals?.Type!=JTokenType.String))throw new OfficeFault("office_check_compare_invalid",invocationStarted:false);}var plannedObjects=new HashSet<string>();foreach(var input in steps.Concat(checks.Select(c=>c.Read))){if(port is IOfficePreflightPort preflight)preflight.ValidateInput(input,plannedObjects);else OfficeArguments.ValidateInput(input,null);if(!String.IsNullOrWhiteSpace(input.Id))plannedObjects.Add(input.Id);}checks=OfficeCountChecks.Prepare(before,steps,checks);var plan=new OfficePlan{Id=Guid.NewGuid().ToString("N"),Summary=summary,Before=Wire.Clone(before),Steps=Wire.Clone(steps),Checks=Wire.Clone(checks)};plans[plan.Id]=plan;return Wire.Clone(plan);}
  static bool Equivalent(JToken a,JToken b){
   bool Number(JToken t)=>t.Type==JTokenType.Integer||t.Type==JTokenType.Float;
   if(Number(a)&&Number(b))return a.Value<double>()==b.Value<double>();
   if(a is JArray aa&&b is JArray ba)return aa.Count==ba.Count&&aa.Zip(ba,Equivalent).All(v=>v);
   return JToken.DeepEquals(a,b);
  }
  static string FormulaKey(string text){var result=new System.Text.StringBuilder();bool literal=false;for(int i=0;i<text.Length;i++){char c=text[i];if(c=='"'){result.Append(c);if(literal&&i+1<text.Length&&text[i+1]=='"'){result.Append(text[++i]);continue;}literal=!literal;}else result.Append(literal?c:char.ToUpperInvariant(c));}return result.ToString();}
  static bool Matches(object actual,OfficeCheck check){var value=actual==null?JValue.CreateNull():JToken.FromObject(actual);return check.Compare=="excel_formula"?value.Type==JTokenType.String&&FormulaKey((string)value)==FormulaKey((string)check.Equals):Equivalent(value,check.Equals);}
  public OfficeExecutionReceipt Apply(string id,bool approved,CancellationToken token)=>ApplyAsync(id,approved,token).GetAwaiter().GetResult();
  public async Task<OfficeExecutionReceipt> ApplyAsync(string id,bool approved,CancellationToken token){if(stopped||id==null||!plans.TryGetValue(id,out var plan))throw new OfficeFault("invalid_plan");plans.Remove(id);var r=new OfficeExecutionReceipt{PlanId=id,Status="rejected"};if(!approved){stopped=true;return r;}
   string stage="source_check",member=null;
   try{token.ThrowIfCancellationRequested();port.CheckSource();stage="source_read";var live=new List<object>();foreach(var before in plan.Before.Steps){member=before.Member;live.Add(port.Execute(before,true));}if(Wire.Hash(live)!=Wire.Hash(plan.Before.Results))throw new OfficeFault("source_changed");
    // Yield only to an installed UI context. A synchronous STA caller without
    // one must not resume COM calls on a ThreadPool thread.
    foreach(var step in plan.Steps){stage="execute_step";member=step.Member;if(SynchronizationContext.Current!=null)await Task.Yield();token.ThrowIfCancellationRequested();bool write=OfficeCallPolicy.WritesDocument(step);if(write){r.Mutated=true;r.WriteResultUncertain=true;}r.Results.Add(port.Execute(step,false));r.Count++;if(write){r.CompletedWrites++;r.WriteResultUncertain=false;}}
    string mismatchMember=null;foreach(var check in plan.Checks){stage="readback";member=check.Read.Member;if(SynchronizationContext.Current!=null)await Task.Yield();token.ThrowIfCancellationRequested();var actual=port.Execute(check.Read,true);bool matches=Matches(actual,check);r.Checks.Add(new{read=check.Read,actual,expected=check.Equals,passed=matches});if(!matches&&mismatchMember==null)mismatchMember=member;}if(mismatchMember!=null)throw new OfficeFault("readback_mismatch",mismatchMember);
    r.Status="verified";observations.Clear();plans.Clear();
   }catch(OperationCanceledException){r.Status=r.Mutated?"partial":"cancelled";r.Error="cancelled";stopped=true;}
   catch(OfficeFault e){if(e.InvocationStarted==false){r.WriteResultUncertain=false;if(r.CompletedWrites==0)r.Mutated=false;}r.Status=r.Mutated?"partial":"conflict";r.Error=e.Message;r.FailedMember=e.Member??member;r.NativeCode=e.NativeCode;r.ExceptionName=e.ExceptionName;r.FailureStage=stage;r.InputPath=e.InputPath;r.InputRule=e.InputRule;r.InvocationStarted=e.InvocationStarted;stopped=!OfficeCallPolicy.CanReplan(r);}
   catch(Exception e){r.Status=r.Mutated?"partial":"failed";r.Error="native_execution_failed";r.FailedMember=member;r.NativeCode="0x"+unchecked((uint)e.HResult).ToString("X8");r.ExceptionName=e.GetType().Name;r.FailureStage=stage;stopped=true;}
   return r;
  }
 }
}
