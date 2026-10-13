using System;
using System.Linq;
using Newtonsoft.Json.Linq;
namespace OfficeX.Core {
 // Native Office uses character units for Excel widths, points for heights,
 // and Single precision for PowerPoint geometry. No guessed pixel conversion.
 public static class OfficeGeometry {
  static readonly string[] Singles={"Left","Top","Width","Height","Size","SlideWidth","SlideHeight"};
  static bool Number(JToken value)=>value!=null&&(value.Type==JTokenType.Integer||value.Type==JTokenType.Float)&&!Double.IsNaN(value.Value<double>())&&!Double.IsInfinity(value.Value<double>());
  public static void ValidateInput(OfficeStep step,string app){
   string leaf=OfficeCallPolicy.Leaf(step.Member);
   if(step.Action=="set"&&(leaf.Equals("ColumnWidth",StringComparison.OrdinalIgnoreCase)||leaf.Equals("RowHeight",StringComparison.OrdinalIgnoreCase))&&(app=="excel"||app==null)){
    double max=leaf.Equals("ColumnWidth",StringComparison.OrdinalIgnoreCase)?255:409;
    if(!Number(step.Value)||step.Value.Value<double>()<0||step.Value.Value<double>()>max)throw new OfficeFault("office_argument_invalid",step.Member,invocationStarted:false,inputPath:"value",inputRule:leaf.Equals("ColumnWidth",StringComparison.OrdinalIgnoreCase)?"column_width_characters_0_to_255":"row_height_points_0_to_409");
   }
   if(app=="powerpoint"&&step.Action=="call"&&leaf.Equals("AddTextbox",StringComparison.OrdinalIgnoreCase)){
    var args=step.Args??new JArray();if(args.Count!=5)throw new OfficeFault("office_argument_count",step.Member,invocationStarted:false,inputPath:"args",inputRule:"textbox_orientation_and_four_point_dimensions_required");
    for(int i=0;i<5;i++)if(!Number(args[i])||(i==0&&(args[i].Type!=JTokenType.Integer||args[i].Value<int>()<1||args[i].Value<int>()>6))||(i>=3&&args[i].Value<double>()<=0)||Double.IsInfinity((float)args[i].Value<double>()))throw new OfficeFault("office_argument_invalid",step.Member,invocationStarted:false,inputPath:"args["+i+"]",inputRule:i==0?"office_text_orientation_required":"finite_point_dimension_required");
   }
  }
  public static void AdaptNativeCheck(OfficeCheck check,string app){
   if(check.Compare!=null)return;string leaf=OfficeCallPolicy.Leaf(check.Read.Member);
   // Excel Bold is Boolean; Word/PPT Bold and Italic are native -1/0.
   if(check.Equals?.Type==JTokenType.Boolean&&(app=="word"||app=="powerpoint")&&(new[]{"Bold","Italic"}.Contains(leaf)||app=="powerpoint"&&new[]{"WordWrap","HasTextFrame"}.Contains(leaf)))check.Equals=new JValue((bool)check.Equals?-1:0);
   if(!Number(check.Equals))return;
   if(app=="powerpoint"&&Singles.Contains(leaf)||app=="word"&&leaf=="Size")check.Compare="office_single";
   else if(app=="excel"&&new[]{"ColumnWidth","RowHeight"}.Contains(leaf))check.Compare="excel_dimension";
  }
  public static void ValidateCheck(OfficeCheck check){
   if(check.Compare==null)return;string leaf=OfficeCallPolicy.Leaf(check.Read.Member);
   bool valid=check.Compare=="excel_formula"?new[]{"Formula","FormulaLocal"}.Contains(leaf)&&check.Equals?.Type==JTokenType.String:
    check.Compare=="excel_dimension"?new[]{"ColumnWidth","RowHeight"}.Contains(leaf)&&Number(check.Equals):
    check.Compare=="office_single"?Singles.Contains(leaf)&&Number(check.Equals)&&!Double.IsInfinity((float)check.Equals.Value<double>()):false;
   if(!valid)throw new OfficeFault("office_check_compare_invalid",invocationStarted:false);
  }
  public static bool Matches(JToken actual,OfficeCheck check){
   if(!Number(actual)||!Number(check.Equals))return false;double expected=check.Equals.Value<double>(),value=actual.Value<double>();
   if(check.Compare=="office_single")return value==(double)(float)expected;
   // Explicit bounded layout policy, not a tolerance for cell data or Count.
   double tolerance=OfficeCallPolicy.Leaf(check.Read.Member)=="ColumnWidth"?0.15:0.5;
   return Math.Abs(value-expected)<=tolerance;
  }
 }
}
