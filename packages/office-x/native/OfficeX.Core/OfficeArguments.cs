using System;
using System.Linq;
using Newtonsoft.Json.Linq;
namespace OfficeX.Core {
 public static class OfficeArguments {
  public static void ValidateItem(System.Collections.Generic.List<object> args){if(args.Count==0||args[0]==null||args[0]==Type.Missing)throw new OfficeFault("office_argument_count","Item",unchecked((int)0x8002000E),false,inputPath:"args[0]",inputRule:"item_index_required");}
  public static object Convert(JToken value,Func<string,object> reference,string path="value"){
   OfficeFault Invalid(string rule)=>new OfficeFault("office_argument_invalid",invocationStarted:false,inputPath:path,inputRule:rule);
   if(value==null||value.Type==JTokenType.Null)return null;
   if(value is JObject obj){
    if(obj.Count==1&&(obj.Property("ref")!=null||obj.Property("reference")!=null)){var id=obj["ref"]??obj["reference"];if(id.Type!=JTokenType.String||string.IsNullOrWhiteSpace((string)id))throw Invalid("office_reference_required");var resolved=reference((string)id);if(resolved==null)throw Invalid("office_reference_unknown");return resolved;}
    if(obj.Count==1&&obj["missing"]?.Type==JTokenType.Boolean&&(bool)obj["missing"])return Type.Missing;
    throw Invalid("office_argument_object_invalid");
   }
   if(value is JArray array){
    if(array.Any(x=>x is JArray)){if(array.Any(x=>!(x is JArray)))throw Invalid("rectangular_matrix_required");int cols=((JArray)array[0]).Count;if(cols==0||array.Any(r=>((JArray)r).Count!=cols))throw Invalid("rectangular_matrix_required");var matrix=new object[array.Count,cols];for(int r=0;r<array.Count;r++)for(int c=0;c<cols;c++)matrix[r,c]=Convert(array[r][c],reference,path+"["+r+"]["+c+"]");return matrix;}
    return array.Select((v,i)=>Convert(v,reference,path+"["+i+"]")).ToArray();
   }
   if(value.Type==JTokenType.Integer){long n=value.Value<long>();return n>=int.MinValue&&n<=int.MaxValue?(object)(int)n:(double)n;}
   if(value.Type==JTokenType.Float){double n=value.Value<double>();if(double.IsNaN(n)||double.IsInfinity(n))throw Invalid("finite_number_required");return n;}
   if(value.Type==JTokenType.Boolean)return value.Value<bool>();
   if(value.Type==JTokenType.String)return value.Value<string>();
   throw Invalid("scalar_or_reference_required");
  }
 }
}
