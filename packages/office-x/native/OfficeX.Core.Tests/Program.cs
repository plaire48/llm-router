using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using OfficeX.Core;

var tests=new (string,Action)[] {
    ("text replacement verifies content and keeps unsaved",()=>{var(p,s,plan)=TextSetup();plan.Replacement="tampered";var r=s.Apply(plan.Id,true,default);Equal("verified",r.Status);Equal("새 문장",p.Data.Text);Equal(false,r.Saved);}),
    ("text source drift blocks writes",()=>{var(p,s,plan)=TextSetup();p.Data.Text="user edit";Equal("conflict",s.Apply(plan.Id,true,default).Status);Equal(0,p.Writes);}),
    ("text other-content drift blocks writes",()=>{var(p,s,plan)=TextSetup();p.Data.SurroundingHash="changed";Equal("conflict",s.Apply(plan.Id,true,default).Status);Equal(0,p.Writes);}),
    ("text rejection and replay never mutate",()=>{var(p,s,plan)=TextSetup();Equal("rejected",s.Apply(plan.Id,false,default).Status);Fault("invalid_plan",()=>s.Apply(plan.Id,true,default));Equal(0,p.Writes);}),
    ("text cancellation before dispatch does not mutate",()=>{var(p,s,plan)=TextSetup();Equal("cancelled",s.Apply(plan.Id,true,new CancellationToken(true)).Status);Equal(0,p.Writes);}),
    ("text uncertain COM failure cannot replay",()=>{var(p,s,plan)=TextSetup();p.Fail=true;Equal("partial",s.Apply(plan.Id,true,default).Status);Fault("invalid_plan",()=>s.Apply(plan.Id,true,default));Equal(1,p.Writes);}),
    ("text formatting drift fails independent readback",()=>{var(p,s,plan)=TextSetup();p.ChangeFormat=true;Equal("partial",s.Apply(plan.Id,true,default).Status);}),
    ("text mixed or complex selection stays readonly",()=>{var p=new FakeTextPort();p.Data.Editable=false;var s=new TextSession(p);var r=s.Read();Fault("text_format_unsupported",()=>s.Prepare(r.SnapshotId,"rewrite"));}),
    ("text new paragraphs cannot expand mutation scope",()=>{var p=new FakeTextPort();var s=new TextSession(p);var r=s.Read();Fault("single_paragraph_required",()=>s.Prepare(r.SnapshotId,"new\nparagraph"));}),
    ("three formulas are applied and independently read back",()=>{
        var (port,session,plan)=Setup();var result=session.Apply(plan.Id,true,CancellationToken.None);
        Equal("verified",result.Status);Equal(3,port.Writes);Equal(false,result.Saved);
        Equal("=C2*D2",port.Cell("E2").Formula);Equal(3000d,port.Cell("E2").Value);
        Equal(6000d,port.Cell("E3").Value);Equal(0d,port.Cell("E4").Value);
        Equal("수량",port.Cell("C1").Value);
    }),
    ("changed operand blocks the whole batch",()=>{var(p,s,plan)=Setup();p.Cell("C2").Value=8d;Equal("conflict",s.Apply(plan.Id,true,default).Status);Equal(0,p.Writes);}),
    ("changed target blocks the whole batch",()=>{var(p,s,plan)=Setup();p.Cell("E3").Value="user";Equal("conflict",s.Apply(plan.Id,true,default).Status);Equal(0,p.Writes);}),
    ("document close never falls back to active workbook",()=>{var(p,s,plan)=Setup();p.Closed=true;Equal("failed",s.Apply(plan.Id,true,default).Status);Equal(0,p.Writes);}),
    ("approval rejection consumes the write without mutation",()=>{var(p,s,plan)=Setup();Equal("cancelled",s.Apply(plan.Id,false,default).Status);Equal("cancelled",s.Apply(plan.Id,true,default).Status);Equal(0,p.Writes);}),
    ("receipt replay never reapplies",()=>{var(p,s,plan)=Setup();var a=s.Apply(plan.Id,true,default);a.Status="corrupted";Equal("verified",s.Apply(plan.Id,true,default).Status);Equal(3,p.Writes);}),
    ("cancel before apply writes nothing",()=>{var(p,s,plan)=Setup();Equal("cancelled",s.Apply(plan.Id,true,new CancellationToken(true)).Status);Equal(0,p.Writes);}),
    ("second COM call failure reports attempted partial receipt",()=>{var(p,s,plan)=Setup();p.FailWriteAt=2;var r=s.Apply(plan.Id,true,default);Equal("partial",r.Status);Equal(2,r.Cells.Count);Equal("attempted",r.Cells[1].Status);Equal(3000d,p.Cell("E2").Value);s.Apply(plan.Id,true,default);Equal(2,p.Writes);}),
    ("failed final readback is not success",()=>{var(p,s,plan)=Setup();p.FailAfterWrite=true;Equal("partial",s.Apply(plan.Id,true,default).Status);}),
    ("wrong calculated result is not success",()=>{var(p,s,plan)=Setup();p.BadCalculation=true;Equal("verification_pending",s.Apply(plan.Id,true,default).Status);}),
    ("incomplete calculation is not success",()=>{var(p,s,plan)=Setup();p.PendingAfterCalculate=true;Equal("verification_pending",s.Apply(plan.Id,true,default).Status);}),
    ("non-target change after calculation is detected",()=>{var(p,s,plan)=Setup();p.ChangeSourceOnCalculate=true;var r=s.Apply(plan.Id,true,default);Equal("verification_pending",r.Status);Equal("non_target_changed",r.Error);}),
    ("caller cannot mutate reviewed plan",()=>{var(p,s,plan)=Setup();plan.Operations[0].Formula="=C3*D3";plan.Before.Cells.Clear();Equal("verified",s.Apply(plan.Id,true,default).Status);Equal("=C2*D2",p.Cell("E2").Formula);}),
    ("caller cannot mutate stored snapshot",()=>{var p=new FakePort();var s=new ExcelSession(p);var snap=s.ReadSelection();snap.Cells.Single(c=>c.Address=="C2").Value=999;var plan=s.Prepare(snap.SnapshotId,Ops());Equal("verified",s.Apply(plan.Id,true,default).Status);}),
    ("outside selection read is rejected",()=>{var p=new FakePort();var s=new ExcelSession(p);Fault("out_of_scope",()=>s.ReadRange("A1"));}),
    ("snapshot must include both operands",()=>{var p=new FakePort();var s=new ExcelSession(p);var snap=s.ReadRange("E2:E4");Fault("numeric_source_required",()=>s.Prepare(snap.SnapshotId,Ops()));}),
    ("model supplied snapshot ID is rejected",()=>{var p=new FakePort();var s=new ExcelSession(p);Fault("snapshot_expired",()=>s.Prepare("invented",Ops()));}),
    ("external and executable formulas are unsupported",()=>{foreach(var f in new[]{"=WEBSERVICE(\"https://example.com\")","=[book.xlsx]Sheet1!C2*D2","=SUM(C2:D2)","=C2*D2+1"}){var p=new FakePort();var s=new ExcelSession(p);var snap=s.ReadSelection();Fault("unsupported_formula",()=>s.Prepare(snap.SnapshotId,new[]{new FormulaOperation{Address="E2",Formula=f}}));}}),
    ("duplicate targets are rejected",()=>{var p=new FakePort();var s=new ExcelSession(p);var snap=s.ReadSelection();Fault("target_invalid",()=>s.Prepare(snap.SnapshotId,new[]{Ops()[0],Ops()[0]}));}),
    ("existing formulas and empty strings are not blank targets",()=>{foreach(var value in new[]{"","existing"}){var p=new FakePort();p.Cell("E2").Value=value;var s=new ExcelSession(p);var snap=s.ReadSelection();Fault("target_not_empty",()=>s.Prepare(snap.SnapshotId,Ops()));}}),
    ("unsafe ranges fail closed",()=>{foreach(var flag in new[]{"Merged","ArrayFormula","Hidden","Table"}){var p=new FakePort();typeof(Cell).GetProperty(flag).SetValue(p.Cell("E2"),true);var s=new ExcelSession(p);var snap=s.ReadSelection();Fault("unsupported_range",()=>s.Prepare(snap.SnapshotId,Ops()));}}),
    ("readonly and protected workbook reject proposals",()=>{foreach(var flag in new[]{"ReadOnly","Protected"}){var p=new FakePort();typeof(Snapshot).GetProperty(flag).SetValue(p.Data,true);var s=new ExcelSession(p);var snap=s.ReadSelection();Fault("workbook_not_writable",()=>s.Prepare(snap.SnapshotId,Ops()));}}),
    ("numeric-looking strings are not numeric evidence",()=>{var p=new FakePort();p.Cell("C2").Value="2";var s=new ExcelSession(p);var snap=s.ReadSelection();Fault("numeric_source_required",()=>s.Prepare(snap.SnapshotId,Ops()));}),
    ("invalid and unbounded addresses reject",()=>{foreach(var a in new[]{"XFE1","A1048577","A0","A1:XFD1048576","Sheet1!A1"}){try{var p=new FakePort();p.Data.Address=a;new ExcelSession(p);throw new Exception("accepted invalid range");}catch(OfficeFault){}}}),
    ("large cell context is rejected before model transfer",()=>{var p=new FakePort();p.Cell("C1").Value=new string('가',50000);Fault("context_limit",()=>new ExcelSession(p));}),
};
int failures=0;foreach(var(name,test) in tests){try{test();Console.WriteLine("PASS "+name);}catch(Exception e){failures++;Console.WriteLine("FAIL "+name+": "+e.Message);}}
Console.WriteLine($"{tests.Length-failures}/{tests.Length} core behavior tests passed; fake port, not Excel COM.");return failures==0?0:1;

static (FakeTextPort,TextSession,TextPlan) TextSetup(){var p=new FakeTextPort();var s=new TextSession(p);var snap=s.Read();return(p,s,s.Prepare(snap.SnapshotId,"새 문장"));}
static (FakePort,ExcelSession,ChangePlan) Setup(){var p=new FakePort();var s=new ExcelSession(p);var snap=s.ReadSelection();return(p,s,s.Prepare(snap.SnapshotId,Ops()));}
static List<FormulaOperation> Ops()=>Enumerable.Range(2,3).Select(r=>new FormulaOperation{Address="E"+r,Formula="=C"+r+"*D"+r}).ToList();
static void Equal(object expected,object actual){if(!Equals(expected,actual))throw new Exception($"Expected {expected}; actual {actual}");}
static void Fault(string code,Action action){try{action();throw new Exception("Expected fault "+code);}catch(OfficeFault e){Equal(code,e.Message);}}

sealed class FakePort:IExcelPort {
    public Snapshot Data=new Snapshot{DocumentId="doc",WorksheetId="sheet",Workbook="fixture",Worksheet="내역",Address="C1:E4",CalculationDone=true};
    public int Writes,FailWriteAt;public bool Closed,FailAfterWrite,BadCalculation,PendingAfterCalculate,ChangeSourceOnCalculate;
    public FakePort(){for(int r=1;r<=4;r++)for(int c=3;c<=5;c++)Data.Cells.Add(new Cell{Address=Region.CellAddress(r,c)});Cell("C1").Value="수량";Cell("D1").Value="단가";Cell("E1").Value="금액";Cell("C2").Value=2d;Cell("D2").Value=1500d;Cell("C3").Value=3d;Cell("D3").Value=2000d;Cell("C4").Value=0d;Cell("D4").Value=500d;}
    public Cell Cell(string address)=>Data.Cells.Single(c=>c.Address==address);
    public Snapshot CaptureSelection()=>Wire.Clone(Data);
    public Snapshot Read(Snapshot binding,string address){if(Closed)throw new OfficeFault("document_closed");if(FailAfterWrite&&Writes>0)throw new OfficeFault("read_failed");var r=Region.Parse(address);var s=Wire.Clone(Data);s.Address=address;s.Cells=s.Cells.Where(c=>r.Contains(Region.Parse(c.Address))).ToList();return s;}
    public void WriteFormula(Snapshot binding,string address,string formula){Writes++;if(Writes==FailWriteAt)throw new OfficeFault("write_failed");var c=Cell(address);c.Formula=formula;var parts=formula.Substring(1).Split('*');c.Value=Convert.ToDouble(Cell(parts[0]).Value)*Convert.ToDouble(Cell(parts[1]).Value);}
    public void Calculate(Snapshot binding){if(BadCalculation)Cell("E2").Value=-1d;if(PendingAfterCalculate)Data.CalculationDone=false;if(ChangeSourceOnCalculate)Cell("D2").Value=9000d;}
}

sealed class FakeTextPort:ITextPort {
 public TextSnapshot Data=new TextSnapshot{App="word",DocumentId="doc",TargetId="range",Text="원래 문장",FormatHash="plain",SurroundingHash="before-after",Editable=true};
 public int Writes;public bool Fail,ChangeFormat;
 public TextSnapshot Capture()=>Wire.Clone(Data);
 public TextSnapshot Read(TextSnapshot binding)=>Wire.Clone(Data);
 public void Replace(TextSnapshot binding,string value){Writes++;Data.Text=value;if(Fail)throw new Exception("COM failed after mutation");if(ChangeFormat)Data.FormatHash="changed";}
}
