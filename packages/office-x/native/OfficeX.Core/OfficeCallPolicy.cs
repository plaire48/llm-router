using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
namespace OfficeX.Core {
 public static class OfficeCallPolicy {
  static readonly HashSet<string> Reads=new HashSet<string>(new[]{"Item","Range","Cell","Characters","Paragraphs","Words","Sentences","Rows","Columns","Cells","Runs","FindBySlideID","get_Address","Address","Information","ComputeStatistics","PivotCaches","PivotTables","ChartObjects","SeriesCollection","Axes","SpecialCells","Find","Offset","Resize"},StringComparer.OrdinalIgnoreCase);
  static readonly HashSet<string> Getters=new HashSet<string>(new[]{"Name","Count","CountLarge","Content","Worksheets","Sheets","ActiveSheet","UsedRange","Font","Bold","Italic","Size","Interior","Color","RGB","Value","Value2","Formula","FormulaLocal","FormulaArray","Text","NumberFormat","ColumnWidth","RowHeight","WrapText","Slides","Shapes","TextFrame","TextFrame2","TextRange","ParagraphFormat","PageSetup","Tables","Sections","Styles","Comments","Revisions","ContentControls","Bookmarks","Headers","Footers","RangeStart","Start","End","ProtectContents","ReadOnly","Saved","FullName","Title","HasFormula","MergeCells","HasArray","Locked","Hidden","Chart","ChartTitle","HasTitle","ChartType","Fill","Line","Shadow","Width","Height","Left","Top","Rotation","SlideID","NotesPage","SlideWidth","SlideHeight","WordWrap","AutoSize","BoundHeight","BoundWidth","HasTextFrame"},StringComparer.OrdinalIgnoreCase);
  static readonly HashSet<string> Denied=new HashSet<string>(new[]{"AddPicture","AddPicture2","AddMediaObject","AddMediaObject2","AddIcon","Add3DModel","UserPicture","GetType","Evaluate","Application","Parent","VBProject","VBE","Run","RunAutoMacros","ExecuteExcel4Macro","DDEInitiate","DDEExecute","DDEPoke","DDERequest","OnTime","OnKey","OnAction","OLEObjects","OLEFormat","AddOLEObject","AddOLEControl","AddFromFile","Open","FollowHyperlink","ExportAsFixedFormat","Save","SaveAs","SaveAs2","SaveCopyAs","Close","Quit"},StringComparer.OrdinalIgnoreCase);
  static bool PathSyntax(string member)=>!String.IsNullOrEmpty(member)&&member.Length<=100&&member.Split('.').Length<=8&&Regex.IsMatch(member,@"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$");
  public static string Leaf(string member)=>member?.Split('.').Last();
  public static bool MethodAccessor(string member)=>PathSyntax(member)&&Reads.Contains(Leaf(member));
  public static bool ReadCall(string member)=>PathSyntax(member)&&(Reads.Contains(Leaf(member))||Getters.Contains(Leaf(member)));
  public static bool WritesDocument(OfficeStep step)=>step.Action=="set"||step.Action=="call"&&!ReadCall(step.Member);
  public static bool Exposed(string member)=>PathSyntax(member)&&member.Split('.').All(part=>!Denied.Contains(part));
  public static void Validate(string member,bool readOnly,string action){if(!PathSyntax(member))throw new OfficeFault(member?.Contains(".")==true?"office_member_path_not_supported":"office_member_unavailable",member,invocationStarted:false);if(!Exposed(member))throw new OfficeFault("office_member_unavailable",member,invocationStarted:false);if(readOnly&&(action=="set"||action=="call"&&!ReadCall(member)))throw new OfficeFault("office_read_requires_get",member,invocationStarted:false);}
  public static bool BeforeInvocation(int hresult)=>hresult==unchecked((int)0x80028018)||hresult==unchecked((int)0x80020003)||hresult==unchecked((int)0x80020006)||hresult==unchecked((int)0x8002000E);
  public static string ErrorCode(int hresult)=>hresult==unchecked((int)0x80020003)||hresult==unchecked((int)0x80020006)?"office_member_not_found":hresult==unchecked((int)0x8002000E)?"office_argument_count":"office_operation_failed";
  public static bool CanReplan(OfficeExecutionReceipt r)=>!r.Mutated&&r.CompletedWrites==0&&!r.WriteResultUncertain&&new[]{"office_member_not_found","office_member_unavailable","office_member_path_not_supported","office_argument_invalid","office_argument_count","office_read_requires_get","office_target_unknown","office_object_id_required"}.Contains(r.Error);
 }
}
