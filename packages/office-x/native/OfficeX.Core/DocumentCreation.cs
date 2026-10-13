using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
namespace OfficeX.Core {
 public sealed class DocumentPart {public string Style {get;set;}="Normal";public string Text {get;set;} public List<List<string>> Rows {get;set;}}
 public sealed class SlideContent {public string Title {get;set;} public List<string> Body {get;set;}=new List<string>();}
 public sealed class SheetContent {public string Name {get;set;} public List<List<string>> Rows {get;set;}}
 public sealed class DocumentDraft {public string Title {get;set;} public List<DocumentPart> Paragraphs {get;set;} public List<SlideContent> Slides {get;set;} public List<SheetContent> Sheets {get;set;}}
 public sealed class CreationPlan {public string Kind {get;set;}="create_document";public string Id {get;set;} public string App {get;set;} public DocumentDraft Content {get;set;}}
 public sealed class CreationReceipt {public string Kind {get;set;}="create_document";public string PlanId {get;set;} public string Status {get;set;} public string Error {get;set;} public string FailedMember {get;set;} public string NativeCode {get;set;} public string ExceptionName {get;set;} public string FailureStage {get;set;} public bool Mutated {get;set;} public bool Saved {get;set;} public string Document {get;set;} public int Count {get;set;}}
 public interface IDocumentCreationPort {void CheckSource();void Create(CreationPlan plan,CancellationToken token);DocumentDraft ReadCreated();string CreatedName {get;}}
 public sealed class DocumentCreation {
  readonly IDocumentCreationPort port;readonly CreationPlan plan;bool consumed;
  public DocumentCreation(IDocumentCreationPort port,string app,DocumentDraft draft){Validate(app,draft);this.port=port;plan=new CreationPlan{Id=Guid.NewGuid().ToString("N"),App=app,Content=Wire.Clone(draft)};}
  public CreationPlan Plan=>Wire.Clone(plan);
  static bool Text(string value,int max)=>value!=null&&value.Length<=max&&!value.Any(char.IsControl);
  static bool Rows(List<List<string>> rows,int maxRows,int maxColumns)=>rows!=null&&rows.Count>0&&rows.Count<=maxRows&&rows[0]!=null&&rows[0].Count>0&&rows[0].Count<=maxColumns&&rows.All(r=>r!=null&&r.Count==rows[0].Count&&r.All(c=>Text(c,2000)));
  public static void Validate(string app,DocumentDraft d){
   bool ok=d!=null&&Text(d.Title,200)&&!string.IsNullOrWhiteSpace(d.Title);
   if(ok&&app=="word")ok=d.Slides==null&&d.Sheets==null&&d.Paragraphs!=null&&d.Paragraphs.Count>0&&d.Paragraphs.Count<=100&&d.Paragraphs.All(p=>p!=null&&(p.Rows!=null?Rows(p.Rows,50,10)&&p.Text==null&&p.Style=="Normal":Text(p.Text,8000)&&new[]{"Title","Heading1","Heading2","Normal"}.Contains(p.Style)));
   else if(ok&&app=="powerpoint")ok=d.Paragraphs==null&&d.Sheets==null&&d.Slides!=null&&d.Slides.Count>0&&d.Slides.Count<=20&&d.Slides.All(s=>s!=null&&Text(s.Title,160)&&s.Body!=null&&s.Body.Count<=8&&s.Body.All(b=>Text(b,300)&&!string.IsNullOrEmpty(b)));
   else if(ok&&app=="excel")ok=d.Paragraphs==null&&d.Slides==null&&d.Sheets!=null&&d.Sheets.Count>0&&d.Sheets.Count<=5&&d.Sheets.All(s=>s!=null&&Text(s.Name,31)&&!string.IsNullOrWhiteSpace(s.Name)&&s.Name.IndexOfAny(new[]{'[',']',':','*','?','/','\\'})<0&&!s.Name.StartsWith("'")&&!s.Name.EndsWith("'")&&Rows(s.Rows,200,20))&&d.Sheets.Select(s=>s.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count()==d.Sheets.Count;
   else ok=false;
   if(!ok||Wire.Json(d).Length>100000)throw new OfficeFault("document_content_invalid");
  }
  public CreationReceipt Apply(string id,bool approved,CancellationToken token){
   if(consumed||id!=plan.Id)throw new OfficeFault("invalid_plan");consumed=true;
   var result=new CreationReceipt{PlanId=id,Status="rejected"};if(!approved)return result;
   string stage="source_check";
   try{token.ThrowIfCancellationRequested();port.CheckSource();token.ThrowIfCancellationRequested();stage="create_document";result.Mutated=true;port.Create(Wire.Clone(plan),token);result.Document=port.CreatedName;token.ThrowIfCancellationRequested();stage="readback";if(Wire.Hash(port.ReadCreated())!=Wire.Hash(plan.Content))throw new OfficeFault("readback_mismatch");result.Status="verified";result.Count=plan.Content.Paragraphs?.Count??plan.Content.Slides?.Count??plan.Content.Sheets.Count;}
   catch(OperationCanceledException){result.Status=result.Mutated?"partial":"cancelled";result.Error="cancelled";}
   catch(OfficeFault e){result.Status=result.Mutated?"partial":"conflict";result.Error=e.Message;result.FailedMember=e.Member;result.NativeCode=e.NativeCode;result.ExceptionName=e.ExceptionName;result.FailureStage=stage;}
   catch(Exception e){result.Status=result.Mutated?"partial":"failed";result.Error="native_execution_failed";result.NativeCode="0x"+unchecked((uint)e.HResult).ToString("X8");result.ExceptionName=e.GetType().Name;result.FailureStage=stage;}
   if(result.Document==null&&result.Mutated)try{result.Document=port.CreatedName;}catch{}
   return result;
  }
 }
 // Replace only the changed span. Unchanged prefix/suffix keep their Office runs.
 public sealed class TextSplice {
  public int Start {get;private set;} public int Length {get;private set;} public string Text {get;private set;}
  public static TextSplice Between(string before,string after){int a=0,b=before.Length,c=after.Length;while(a<b&&a<c&&before[a]==after[a])a++;if(a>0&&a<b&&char.IsLowSurrogate(before[a]))a--;while(b>a&&c>a&&before[b-1]==after[c-1]){b--;c--;}if(b<before.Length&&b>0&&char.IsLowSurrogate(before[b])){b++;c++;}return new TextSplice{Start=a,Length=b-a,Text=after.Substring(a,c-a)};}
 }
}
