using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
namespace OfficeX.Core {
 public sealed class WorksheetInfo {public int Index {get;set;} public string Name {get;set;} public string Reference {get;set;}}
 public sealed class WorksheetList {public string SnapshotId {get;set;} public int Count {get;set;} public int Start {get;set;} public bool More {get;set;} public List<WorksheetInfo> Worksheets {get;set;} public OfficeObservation Observation {get;set;}}
 public static class ExcelWorksheets {
  const string Collection="worksheet_list_collection";
  public static WorksheetList Read(OfficeAutomationSession session,int start=1,int count=50,bool allSheets=false){
   if(start<1||count<1||count>400)throw new OfficeFault("worksheet_request_invalid",invocationStarted:false);
   string collection=allSheets?"worksheet_all_collection":Collection,prefix=allSheets?"worksheet_all_":"worksheet_list_";
   var roots=new List<OfficeStep>{new OfficeStep{Id=collection,Member=allSheets?"Sheets":"Worksheets"},new OfficeStep{Target=collection,Member="Count"}};
   var initial=session.Inspect(roots);int total=Convert.ToInt32(initial.Results[1]);
   if(total<0)throw new OfficeFault("worksheet_request_invalid",invocationStarted:false);
   if(start>Math.Max(1,total))throw new OfficeFault("worksheet_request_invalid",invocationStarted:false);
   int end=Math.Min(total,start+count-1);var reads=new List<OfficeStep>(roots);
   for(int i=start;i<=end;i++){string id=prefix+i;reads.Add(new OfficeStep{Id=id,Target=collection,Member="Item",Args=new JArray(i)});reads.Add(new OfficeStep{Target=id,Member="Name"});}
   var observed=session.Inspect(reads);
   // Do not turn an intervening structural change into a guessed list.
   if(Convert.ToInt32(observed.Results[1])!=total)throw new OfficeFault("source_changed",invocationStarted:false);
   return new WorksheetList{SnapshotId=observed.SnapshotId,Count=total,Start=start,More=end<total,Observation=observed,Worksheets=Enumerable.Range(start,end-start+1).Select((i)=>new WorksheetInfo{Index=i,Name=Convert.ToString(observed.Results[3+2*(i-start)]),Reference=prefix+i}).ToList()};
  }
  static void Name(string name){if(String.IsNullOrWhiteSpace(name)||name.Length>31||name.IndexOfAny(new[]{'[',']',':','*','?','/','\\'})>=0||name.StartsWith("'")||name.EndsWith("'")||name.Any(Char.IsControl))throw new OfficeFault("worksheet_name_invalid",invocationStarted:false,inputPath:"name",inputRule:"excel_worksheet_name_required");}
  public static OfficePlan Prepare(OfficeAutomationSession session,JObject input,bool add){
   string name=(string)input["name"];Name(name);
   var list=Read(session,1,400);var all=Read(session,1,400,true);if(list.More||all.More)throw new OfficeFault("worksheet_list_limit",invocationStarted:false);
   WorksheetInfo target=null;
   if(!add){string old=(string)input["sheet"];if(String.IsNullOrWhiteSpace(old))throw new OfficeFault("worksheet_request_invalid",invocationStarted:false);target=list.Worksheets.FirstOrDefault(s=>String.Equals(s.Name,old,StringComparison.OrdinalIgnoreCase));if(target==null)throw new OfficeFault("worksheet_not_found",invocationStarted:false,inputPath:"sheet");}
   if(all.Worksheets.Any(s=>!(target!=null&&String.Equals(s.Name,target.Name,StringComparison.OrdinalIgnoreCase))&&String.Equals(s.Name,name,StringComparison.OrdinalIgnoreCase)))throw new OfficeFault("worksheet_name_conflict",invocationStarted:false,inputPath:"name");
   var originals=list.Observation.Results.Concat(all.Observation.Results).ToList();var originalsSteps=list.Observation.Steps.Concat(all.Observation.Steps).ToList();if(originalsSteps.Count>1000)throw new OfficeFault("worksheet_list_limit",invocationStarted:false);
   var before=session.Inspect(originalsSteps);if(Wire.Hash(before.Results)!=Wire.Hash(originals))throw new OfficeFault("source_changed",invocationStarted:false);
   if(add&&all.Worksheets.Count==0)throw new OfficeFault("worksheet_required",invocationStarted:false);
   var steps=new List<OfficeStep>();var checks=new List<OfficeCheck>();string id=target?.Reference??"worksheet_added";
   if(add)steps.Add(new OfficeStep{Id=id,Target=Collection,Action="call",Member="Add",Args=new JArray(Wire.Parse("{missing:true}"),new JObject{{"reference",all.Worksheets.Last().Reference}})});
   steps.Add(new OfficeStep{Target=id,Action="set",Member="Name",Value=name});
   checks.Add(new OfficeCheck{Read=new OfficeStep{Target=Collection,Member="Count"},Equals=list.Count+(add?1:0)});
   checks.Add(new OfficeCheck{Read=new OfficeStep{Target=id,Member="Name"},Equals=name});
   foreach(var sheet in all.Worksheets.Where(s=>target==null||!String.Equals(s.Name,target.Name,StringComparison.OrdinalIgnoreCase)))checks.Add(new OfficeCheck{Read=new OfficeStep{Target=sheet.Reference,Member="Name"},Equals=sheet.Name});
   return session.Prepare(before.SnapshotId,(string)input["summary"]??(add?"새 시트 “"+name+"”을 추가합니다.":"“"+target.Name+"” 시트를 “"+name+"”으로 변경합니다."),steps,checks);
  }
 }
}
