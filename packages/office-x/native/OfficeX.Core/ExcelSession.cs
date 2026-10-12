using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Text;
using System.Threading;

namespace OfficeX.Core
{
    // This native-owned session is the authority. The model never supplies snapshots,
    // approval flags, document identities or computed success receipts.
    public sealed class ExcelSession
    {
        private readonly IExcelPort port;
        private readonly Snapshot scope;
        private readonly Dictionary<string, Snapshot> snapshots = new Dictionary<string, Snapshot>();
        private readonly Dictionary<string, ChangePlan> plans = new Dictionary<string, ChangePlan>();
        private readonly Dictionary<string, ApplyReceipt> receipts = new Dictionary<string, ApplyReceipt>();
        private bool writeConsumed;
        private static readonly Regex Product = new Regex(@"^=([A-Z]{1,3}[1-9][0-9]{0,6})\*([A-Z]{1,3}[1-9][0-9]{0,6})$", RegexOptions.CultureInvariant);
        public ExcelSession(IExcelPort port) {
            this.port=port; scope=Wire.Clone(port.CaptureSelection()); ValidateSnapshot(scope);
        }
        public Snapshot Context => Wire.Clone(scope);
        public Snapshot ReadSelection() => ReadRange(scope.Address);
        public Snapshot ReadRange(string address) {
            var region=Region.Parse(address);
            if(region.Rows>101||region.Columns>20||(long)region.Rows*region.Columns>2020)throw new OfficeFault("range_limit");
            var current=port.Read(scope, region.Address); ValidateSnapshot(current);
            if(current.DocumentId!=scope.DocumentId||current.WorksheetId!=scope.WorksheetId||current.Address!=region.Address)throw new OfficeFault("source_changed");
            current.SnapshotId=Guid.NewGuid().ToString("N");
            if(snapshots.Count>=32) snapshots.Remove(snapshots.Keys.First());
            snapshots.Add(current.SnapshotId,Wire.Clone(current)); return Wire.Clone(current);
        }
        public ExcelReadContext ReadContext(){
            if(!(port is IExcelContextPort contextPort))throw new OfficeFault("read_context_unavailable");
            return contextPort.GetReadContext(scope);
        }
        public object ReadSurrounding(){var context=ReadContext();return new{snapshot=ReadRange(context.SurroundingRange),selection=scope.Address,sourceRange=context.CurrentRegion,truncated=context.Truncated};}
        private void ValidateWriteScope(IList<FormulaOperation> operations){
            var allowed=Region.Parse(scope.Address);
            if(operations==null||operations.Any(op=>op==null||!allowed.Contains(Region.Parse(op.Address))))throw new OfficeFault("write_out_of_scope");
        }
        public Snapshot CalculateAndRead() { port.Calculate(scope); return ReadSelection(); }
        public ChangePlan Prepare(string snapshotId, IList<FormulaOperation> operations) {
            if(writeConsumed) throw new OfficeFault("writes_stopped_for_this_run");
            if(snapshotId==null || !snapshots.TryGetValue(snapshotId,out var snapshot)) throw new OfficeFault("snapshot_expired");
            if(operations==null || operations.Count<1 || operations.Count>100) throw new OfficeFault("operation_limit");
            var copy=Wire.Clone(operations.ToList()); ValidateWriteScope(copy); ValidateOperations(snapshot,copy);
            if(plans.Count>=16) throw new OfficeFault("plan_limit");
            var plan=new ChangePlan {Id=Guid.NewGuid().ToString("N"), Before=Wire.Clone(snapshot), Operations=copy};
            plans.Add(plan.Id,plan); return Wire.Clone(plan);
        }
        // Only the native UI invokes this method after displaying the immutable plan.
        public ApplyReceipt Apply(string planId, bool approved, CancellationToken cancellation) {
            if(planId==null) throw new OfficeFault("plan_missing");
            if(receipts.TryGetValue(planId,out var previous)) return Wire.Clone(previous);
            if(!plans.TryGetValue(planId,out var plan)) throw new OfficeFault("plan_missing");
            if(writeConsumed) throw new OfficeFault("writes_stopped_for_this_run");
            writeConsumed=true;
            var receipt=new ApplyReceipt {PlanId=planId,Status="failed"};
            // Record before attempting any mutation. A lost response cannot replay it.
            receipts.Add(planId,receipt);
            if(!approved || cancellation.IsCancellationRequested) { receipt.Status="cancelled"; return Wire.Clone(receipt); }
            try {
                var live=port.Read(scope,plan.Before.Address);
                if(live.Fingerprint()!=plan.Before.Fingerprint()) { receipt.Status="conflict"; receipt.Error="source_changed"; return Wire.Clone(receipt); }
                ValidateWriteScope(plan.Operations); ValidateOperations(live,plan.Operations);
                foreach(var op in plan.Operations) {
                    cancellation.ThrowIfCancellationRequested();
                    var entry=new CellReceipt {Address=op.Address,Formula=op.Formula,Status="attempted",
                        BeforeValue=live.Cells.Single(c=>c.Address==op.Address).Value,
                        ExpectedValue=Expected(live,op.Formula)};
                    receipt.Cells.Add(entry);
                    // Conservatively mark possible mutation before entering COM.
                    receipt.Mutated=true;
                    port.WriteFormula(scope,op.Address,op.Formula); entry.Status="applied";
                }
                port.Calculate(scope);
                var after=port.Read(scope,plan.Before.Address);
                ValidateSnapshot(after);
                foreach(var entry in receipt.Cells) {
                    var cell=after.Cells.Single(c=>c.Address==entry.Address); entry.ActualValue=cell.Value;
                    entry.Status=after.CalculationDone && !cell.Error && cell.Formula==entry.Formula &&
                        Numeric(cell.Value,out var n) && Math.Abs(n-entry.ExpectedValue)<=Math.Max(1,Math.Abs(entry.ExpectedValue))*1e-10 ? "verified" : "unverified";
                }
                // The selected source cells must not have changed during calculation/write.
                var targets=new HashSet<string>(plan.Operations.Select(o=>o.Address));
                bool preserved=after.Cells.Where(c=>!targets.Contains(c.Address)).All(c=>
                    Wire.Json(c)==Wire.Json(plan.Before.Cells.Single(b=>b.Address==c.Address)));
                receipt.Status=preserved && receipt.Cells.All(c=>c.Status=="verified") ? "verified" : "verification_pending";
                if(!preserved) receipt.Error="non_target_changed";
            } catch(OperationCanceledException) { receipt.Status=receipt.Mutated ? "partial" : "cancelled"; receipt.Error="cancelled"; }
            catch(OfficeFault e) { receipt.Status=receipt.Mutated ? "partial" : "failed"; receipt.Error=e.Message; }
            catch { receipt.Status=receipt.Mutated ? "partial" : "failed"; receipt.Error="native_execution_failed"; }
            return Wire.Clone(receipt);
        }
        public IReadOnlyList<ApplyReceipt> Receipts => receipts.Values.Select(Wire.Clone).ToList();
        private static void ValidateSnapshot(Snapshot s) {
            if(s==null || string.IsNullOrEmpty(s.DocumentId) || string.IsNullOrEmpty(s.WorksheetId)) throw new OfficeFault("document_missing");
            var r=Region.Parse(s.Address);
            if(r.Rows>101 || r.Columns>20 || (long)r.Rows*r.Columns>2020) throw new OfficeFault("range_limit");
            if(s.Cells==null || s.Cells.Count!=r.Rows*r.Columns || s.Cells.Select(c=>c.Address).Distinct().Count()!=s.Cells.Count ||
                s.Cells.Any(c=>!r.Contains(Region.Parse(c.Address)) || Region.Parse(c.Address).Rows!=1 || Region.Parse(c.Address).Columns!=1)) throw new OfficeFault("snapshot_invalid");
            if(Encoding.UTF8.GetByteCount(Wire.Json(s))>128*1024) throw new OfficeFault("context_limit");
        }
        private static void ValidateOperations(Snapshot s,IList<FormulaOperation> operations) {
            ValidateSnapshot(s);
            if(s.ReadOnly || s.Protected) throw new OfficeFault("workbook_not_writable");
            if(!s.CalculationDone) throw new OfficeFault("calculation_pending");
            if(s.Cells.Any(c=>c.Merged || c.ArrayFormula || c.Hidden || c.Table)) throw new OfficeFault("unsupported_range");
            var seen=new HashSet<string>(); var range=Region.Parse(s.Address);
            foreach(var op in operations) {
                if(op==null) throw new OfficeFault("operation_invalid");
                var target=Region.Parse(op.Address);
                if(target.Rows!=1 || target.Columns!=1 || !range.Contains(target) || !seen.Add(op.Address)) throw new OfficeFault("target_invalid");
                var cell=s.Cells.Single(c=>c.Address==op.Address);
                if(cell.Value!=null || !string.IsNullOrEmpty(cell.Formula)) throw new OfficeFault("target_not_empty");
                Expected(s,op.Formula);
            }
            foreach(var op in operations) {
                var m=Product.Match(op.Formula);
                if(seen.Contains(m.Groups[1].Value)||seen.Contains(m.Groups[2].Value)) throw new OfficeFault("formula_dependency_on_target");
            }
        }
        private static double Expected(Snapshot s,string formula) {
            var m=Product.Match(formula??""); if(!m.Success) throw new OfficeFault("unsupported_formula");
            double Operand(string address) {
                var cell=s.Cells.SingleOrDefault(c=>c.Address==address);
                if(cell==null || cell.Error || !Numeric(cell.Value,out var value)) throw new OfficeFault("numeric_source_required");
                return value;
            }
            var result=Operand(m.Groups[1].Value)*Operand(m.Groups[2].Value);
            if(double.IsNaN(result)||double.IsInfinity(result)) throw new OfficeFault("numeric_overflow");
            return result;
        }
        private static bool Numeric(object value,out double number) {
            number=0; if(value==null || value is string || value is bool) return false;
            try { number=Convert.ToDouble(value,CultureInfo.InvariantCulture); return !double.IsNaN(number)&&!double.IsInfinity(number); } catch {return false;}
        }
    }
}
