using System;
using System.Threading;
namespace OfficeX.Core {
 public sealed class TextSnapshot {
  public string SnapshotId {get;set;}
  public string App {get;set;}
  public string DocumentId {get;set;}
  public string TargetId {get;set;}
  public string Document {get;set;}
  public string Location {get;set;}
  public string Text {get;set;}
  public string SurroundingHash {get;set;}
  public string FormatHash {get;set;}
  public bool Editable {get;set;}
  public string Fingerprint(){var c=Wire.Clone(this);c.SnapshotId=null;return Wire.Hash(c);}
 }
 public sealed class TextPlan {public string Id {get;set;} public TextSnapshot Before {get;set;} public string Replacement {get;set;}}
 public sealed class TextReceipt {public string PlanId {get;set;} public string Status {get;set;} public string Error {get;set;} public bool Mutated {get;set;} public bool Saved {get;set;} public string ActualText {get;set;} public int Count {get;set;}}
 public interface ITextPort {TextSnapshot Capture();TextSnapshot Read(TextSnapshot binding);void Replace(TextSnapshot binding,string text);}
 public sealed class TextSession {
  readonly ITextPort port; readonly TextSnapshot binding; TextSnapshot observation;TextPlan plan;bool consumed;
  public TextSession(ITextPort port){this.port=port;binding=port.Capture();Validate(binding);}
  public TextSnapshot Context=>Wire.Clone(binding);
  static void Validate(TextSnapshot s){if(s==null||string.IsNullOrEmpty(s.DocumentId)||string.IsNullOrEmpty(s.TargetId)||s.Text==null||s.Text.Length>8000)throw new OfficeFault("text_scope_invalid");}
  public TextSnapshot Read(){var s=port.Read(binding);Validate(s);if(s.DocumentId!=binding.DocumentId||s.TargetId!=binding.TargetId)throw new OfficeFault("source_changed");s.SnapshotId=Guid.NewGuid().ToString("N");observation=Wire.Clone(s);return s;}
  public TextPlan Prepare(string snapshotId,string replacement){
   if(consumed||plan!=null)throw new OfficeFault("writes_stopped_for_this_run");
   if(observation==null||snapshotId!=observation.SnapshotId)throw new OfficeFault("snapshot_required");
   if(!observation.Editable)throw new OfficeFault("text_format_unsupported");
   if(string.IsNullOrWhiteSpace(replacement)||replacement.Length>8000||replacement.IndexOfAny(new[]{'\r','\n','\t','\a','\v','\f','\0'})>=0)throw new OfficeFault("single_paragraph_required");
   if(replacement==observation.Text)throw new OfficeFault("no_change");
   plan=new TextPlan{Id=Guid.NewGuid().ToString("N"),Before=Wire.Clone(observation),Replacement=replacement};return Wire.Clone(plan);
  }
  public TextReceipt Apply(string id,bool approved,CancellationToken token){
   if(plan==null||plan.Id!=id||consumed)throw new OfficeFault("invalid_plan");consumed=true;
   var receipt=new TextReceipt{PlanId=id,Status="rejected"};if(!approved)return receipt;
   try{
    token.ThrowIfCancellationRequested();var live=port.Read(binding);
    if(live.Fingerprint()!=plan.Before.Fingerprint())throw new OfficeFault("source_changed");
    token.ThrowIfCancellationRequested();receipt.Mutated=true; // A COM exception after dispatch is an uncertain mutation.
    port.Replace(binding,plan.Replacement);var after=port.Read(binding);receipt.ActualText=after.Text;
    if(after.DocumentId!=binding.DocumentId||after.TargetId!=binding.TargetId||after.Text!=plan.Replacement||after.SurroundingHash!=plan.Before.SurroundingHash||after.FormatHash!=plan.Before.FormatHash)throw new OfficeFault("readback_mismatch");
    receipt.Status="verified";receipt.Count=1;
   }catch(OperationCanceledException){receipt.Status=receipt.Mutated?"partial":"cancelled";receipt.Error="cancelled";}
   catch(OfficeFault e){receipt.Status=receipt.Mutated?"partial":"conflict";receipt.Error=e.Message;}
   catch{receipt.Status=receipt.Mutated?"partial":"failed";receipt.Error="native_execution_failed";}
   return receipt;
  }
 }
}
