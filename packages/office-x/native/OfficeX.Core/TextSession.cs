using System;
using System.Threading;
using System.Collections.Generic;
using System.Linq;
namespace OfficeX.Core {
 public sealed class TextBlock {public string Id {get;set;} public string Label {get;set;} public string Text {get;set;} public string FormatHash {get;set;} public bool Editable {get;set;} public string EditReason {get;set;} public string StructureHash {get;set;}}
 public sealed class TextOperation {public string BlockId {get;set;} public string Text {get;set;}}
 public interface ITextBatchPort {void ReplaceBlocks(TextSnapshot binding,IReadOnlyList<TextOperation> operations);object ReadOutline();}
 public sealed class TextSnapshot {
  public List<TextBlock> Blocks {get;set;}=new List<TextBlock>();
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
 public sealed class TextPlan {public string Id {get;set;} public TextSnapshot Before {get;set;} public string Replacement {get;set;} public List<TextOperation> Operations {get;set;}=new List<TextOperation>();}
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
   if(!observation.Editable||observation.Blocks.Count>1)throw new OfficeFault("text_format_unsupported");
   if(string.IsNullOrWhiteSpace(replacement)||replacement.Length>8000||replacement.IndexOfAny(new[]{'\r','\n','\t','\a','\v','\f','\0'})>=0)throw new OfficeFault("single_paragraph_required");
   if(replacement==observation.Text)throw new OfficeFault("no_change");
   plan=new TextPlan{Id=Guid.NewGuid().ToString("N"),Before=Wire.Clone(observation),Replacement=replacement};return Wire.Clone(plan);
  }
  public TextPlan PrepareBlocks(string snapshotId,List<TextOperation> operations){
   if(consumed||plan!=null)throw new OfficeFault("writes_stopped_for_this_run");
   if(observation==null||snapshotId!=observation.SnapshotId)throw new OfficeFault("snapshot_required");
   if(!(port is ITextBatchPort)||operations==null||operations.Count<1||operations.Count>30||operations.Select(o=>o?.BlockId).Distinct().Count()!=operations.Count)throw new OfficeFault("text_operations_invalid");
   foreach(var op in operations){
    var block=observation.Blocks.SingleOrDefault(b=>b.Id==op?.BlockId);
    if(block==null)throw new OfficeFault("out_of_scope");
    if(!block.Editable)throw new OfficeFault("text_format_unsupported");
    if(string.IsNullOrWhiteSpace(op.Text)||op.Text.Length>8000||op.Text.IndexOfAny(new[]{'\r','\n','\t','\a','\v','\f','\0'})>=0)throw new OfficeFault("single_paragraph_required");
    if(block.Text==op.Text)throw new OfficeFault("no_change");
   }
   var expected=observation.Blocks.Sum(b=>operations.FirstOrDefault(o=>o.BlockId==b.Id)?.Text.Length??b.Text.Length);
   if(expected+Math.Max(0,observation.Blocks.Count-1)>8000)throw new OfficeFault("text_scope_invalid");
   plan=new TextPlan{Id=Guid.NewGuid().ToString("N"),Before=Wire.Clone(observation),Operations=Wire.Clone(operations)};return Wire.Clone(plan);
  }
  public TextReceipt Apply(string id,bool approved,CancellationToken token){
   if(plan==null||plan.Id!=id||consumed)throw new OfficeFault("invalid_plan");consumed=true;
   var receipt=new TextReceipt{PlanId=id,Status="rejected"};if(!approved)return receipt;
   try{
    token.ThrowIfCancellationRequested();var live=port.Read(binding);
    if(live.Fingerprint()!=plan.Before.Fingerprint())throw new OfficeFault("source_changed");
    token.ThrowIfCancellationRequested();receipt.Mutated=true; // A COM exception after dispatch is an uncertain mutation.
    if(plan.Operations.Count>0)((ITextBatchPort)port).ReplaceBlocks(binding,plan.Operations);else port.Replace(binding,plan.Replacement);
    var after=port.Read(binding);receipt.ActualText=after.Text;
    if(after.DocumentId!=binding.DocumentId||after.TargetId!=binding.TargetId||(plan.Operations.Count==0&&after.Text!=plan.Replacement)||after.SurroundingHash!=plan.Before.SurroundingHash||(plan.Operations.Count==0&&plan.Before.Blocks.Count==0&&after.FormatHash!=plan.Before.FormatHash))throw new OfficeFault("readback_mismatch");
    if(plan.Before.Blocks.Count>0){
     if(after.Blocks.Count!=plan.Before.Blocks.Count)throw new OfficeFault("readback_mismatch");
     foreach(var before in plan.Before.Blocks){var actual=after.Blocks.SingleOrDefault(b=>b.Id==before.Id);var expected=plan.Operations.FirstOrDefault(o=>o.BlockId==before.Id)?.Text??(plan.Operations.Count==0?plan.Replacement:before.Text);if(actual==null||actual.Text!=expected||((plan.Operations.Count==0||plan.Operations.Any(o=>o.BlockId==before.Id))&&before.StructureHash!=null?actual.StructureHash!=before.StructureHash:actual.FormatHash!=before.FormatHash))throw new OfficeFault("readback_mismatch");}
    }
    receipt.Status="verified";receipt.Count=plan.Operations.Count>0?plan.Operations.Count:1;
   }catch(OperationCanceledException){receipt.Status=receipt.Mutated?"partial":"cancelled";receipt.Error="cancelled";}
   catch(OfficeFault e){receipt.Status=receipt.Mutated?"partial":"conflict";receipt.Error=e.Message;}
   catch{receipt.Status=receipt.Mutated?"partial":"failed";receipt.Error="native_execution_failed";}
   return receipt;
  }
 }
}
