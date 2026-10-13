using System;
using System.Collections.Generic;
namespace OfficeX.Core {
 public static class OfficePath {
  // Only explicit selector arguments are consumed. Never invent a sheet index,
  // range or selected cell when an indexed path omitted its arguments.
  public static object Resolve(object target,IEnumerable<string> members,List<object> args,string app,Func<object,string,object[],object> get){
   foreach(string member in members){
    int count=String.Equals(member,"Item",StringComparison.OrdinalIgnoreCase)?1:String.Equals(member,"Range",StringComparison.OrdinalIgnoreCase)?app=="word"?2:app=="excel"?1:0:0;
    if(args.Count<count)throw new OfficeFault("office_argument_count",member,invocationStarted:false,inputPath:"args",inputRule:"indexed_path_arguments_required");
    var selectors=count==0?new object[0]:args.GetRange(0,count).ToArray();if(count>0)args.RemoveRange(0,count);
    target=get(target,member,selectors);
   }
   return target;
  }
 }
}
