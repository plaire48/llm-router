using System;
using System.Collections.Generic;
using System.Linq;
namespace OfficeX.Core {
 public static class ExcelWorksheetPaths {
  static bool Collection(string name)=>String.Equals(name,"Worksheets",StringComparison.OrdinalIgnoreCase)||String.Equals(name,"Sheets",StringComparison.OrdinalIgnoreCase);
  public static void Validate(OfficeStep step,ISet<string> collections=null,bool targetIsHandle=false){
   bool known=collections?.Contains(step.Target??"document")==true;
   var member=step.Member.Split('.');
   // Actual named collection handles are authoritative, even when an id
   // happens to contain a dot. Do not silently choose the first worksheet.
   var parts=(known||targetIsHandle?Enumerable.Empty<string>():(step.Target??"document").Split('.').AsEnumerable()).Concat(member).ToArray();
   if(known&&String.Equals(member[0],"Name",StringComparison.OrdinalIgnoreCase)||parts.Zip(parts.Skip(1),(a,b)=>Collection(a)&&String.Equals(b,"Name",StringComparison.OrdinalIgnoreCase)).Any(x=>x))
    throw new OfficeFault("office_member_not_found",step.Member,invocationStarted:false,inputRule:"worksheet_required");
  }
  public static void ValidateBatch(OfficeObservation before,List<OfficeStep> steps,List<OfficeCheck> checks){
   var collections=new HashSet<string>();var handles=new HashSet<string>();
   void Track(OfficeStep s){if(String.IsNullOrWhiteSpace(s.Id))return;handles.Add(s.Id);if(s.Action!="set"&&Collection(OfficeCallPolicy.Leaf(s.Member)))collections.Add(s.Id);else collections.Remove(s.Id);}
   foreach(var read in before.Steps)Track(read);
   foreach(var s in steps.Concat(checks.Select(c=>c.Read))){Validate(s,collections,handles.Contains(s.Target??"document"));Track(s);}
  }
  public static bool IsCollectionMember(string member)=>Collection(OfficeCallPolicy.Leaf(member));
 }
}
