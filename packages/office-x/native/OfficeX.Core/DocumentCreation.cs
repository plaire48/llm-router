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
 public interface IDocumentCreationState {bool CreatedDocumentExists {get;}}
 public sealed class DocumentCreation {
  readonly IDocumentCreationPort port;readonly CreationPlan plan;bool consumed;
  public DocumentCreation(IDocumentCreationPort port,string app,DocumentDraft draft){this.port=port;plan=new CreationPlan{Id=Guid.NewGuid().ToString("N"),App=app,Content=Prepare(app,draft)};}
  public CreationPlan Plan=>Wire.Clone(plan);
  static bool Text(string value,int max,bool multiline=false)=>value!=null&&value.Length<=max&&!value.Any(c=>char.IsControl(c)&&!(multiline&&(c=='\r'||c=='\n'||c=='\t')));
  static void Require(bool ok,string path,string rule){if(!ok)throw new OfficeFault("document_content_invalid",invocationStarted:false,inputPath:path,inputRule:rule);}
  static void CheckText(string value,int max,string path,bool multiline=false){Require(value!=null,path,"text_required");Require(value.Length<=max,path,"max_length_"+max);Require(Text(value,max,multiline),path,"unsupported_control_character");}
  static void CheckRows(List<List<string>> rows,int maxRows,int maxColumns,string path,bool excel=false){
   Require(rows!=null&&rows.Count>0,path,"rows_required");Require(rows.Count<=maxRows,path,"max_rows_"+maxRows);
   int width=0;
   for(int i=0;i<rows.Count;i++){
    var row=rows[i];string at=path+"["+i+"]";Require(row!=null&&row.Count>0,at,"row_required");Require(row.Count<=maxColumns,at,"max_columns_"+maxColumns);
    if(i==0)width=row.Count;else if(!excel)Require(row.Count==width,at,"rectangular_table_required");
    for(int j=0;j<row.Count;j++)CheckText(row[j],2000,at+"["+j+"]",excel);
   }
  }
  // Excel accepts line breaks and tabs in literal cells. Short rows describe
  // empty trailing cells; pad a private copy before both review and readback.
  // No populated cell is truncated, coerced or silently renamed.
  static DocumentDraft Prepare(string app,DocumentDraft d){
   Require(d!=null,"content","content_required");Require(new[]{"word","powerpoint","excel"}.Contains(app),"app","unsupported_app");
   CheckText(d.Title,200,"title");Require(!string.IsNullOrWhiteSpace(d.Title),"title","title_required");
   Require(Wire.Json(d).Length<=100000,"content","max_content_100000");
   if(app=="word"){
    Require(d.Slides==null&&d.Sheets==null,"content","word_paragraphs_only");Require(d.Paragraphs!=null&&d.Paragraphs.Count>0,"paragraphs","paragraphs_required");Require(d.Paragraphs.Count<=100,"paragraphs","max_paragraphs_100");
    for(int i=0;i<d.Paragraphs.Count;i++){var p=d.Paragraphs[i];string at="paragraphs["+i+"]";Require(p!=null,at,"paragraph_required");
     if(p.Rows!=null){Require(p.Text==null&&p.Style=="Normal",at,"table_rows_only");CheckRows(p.Rows,50,10,at+".rows");}
     else{Require(new[]{"Title","Heading1","Heading2","Normal"}.Contains(p.Style),at+".style","paragraph_style_invalid");CheckText(p.Text,8000,at+".text");}
    }
   }else if(app=="powerpoint"){
    Require(d.Paragraphs==null&&d.Sheets==null,"content","powerpoint_slides_only");Require(d.Slides!=null&&d.Slides.Count>0,"slides","slides_required");Require(d.Slides.Count<=20,"slides","max_slides_20");
    for(int i=0;i<d.Slides.Count;i++){var slide=d.Slides[i];string at="slides["+i+"]";Require(slide!=null,at,"slide_required");CheckText(slide.Title,160,at+".title");Require(slide.Body!=null,at+".body","body_required");Require(slide.Body.Count<=8,at+".body","max_body_8");for(int j=0;j<slide.Body.Count;j++){CheckText(slide.Body[j],300,at+".body["+j+"]");Require(!string.IsNullOrEmpty(slide.Body[j]),at+".body["+j+"]","body_text_required");}}
   }else{
    Require(d.Paragraphs==null&&d.Slides==null,"content","excel_sheets_only");Require(d.Sheets!=null&&d.Sheets.Count>0,"sheets","sheets_required");Require(d.Sheets.Count<=5,"sheets","max_sheets_5");var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    for(int i=0;i<d.Sheets.Count;i++){var sheet=d.Sheets[i];string at="sheets["+i+"]";Require(sheet!=null,at,"sheet_required");CheckText(sheet.Name,31,at+".name");Require(!string.IsNullOrWhiteSpace(sheet.Name)&&sheet.Name.IndexOfAny(new[]{'[',']',':','*','?','/','\\'})<0&&!sheet.Name.StartsWith("'")&&!sheet.Name.EndsWith("'"),at+".name","sheet_name_invalid");Require(names.Add(sheet.Name),at+".name","sheet_name_duplicate");CheckRows(sheet.Rows,200,20,at+".rows",true);}
   }
   var normalized=Wire.Clone(d);
   if(app=="excel")foreach(var sheet in normalized.Sheets){int width=sheet.Rows.Max(r=>r.Count);foreach(var row in sheet.Rows)while(row.Count<width)row.Add("");}
   Require(Wire.Json(normalized).Length<=100000,"content","max_content_100000");return normalized;
  }
  public static void Validate(string app,DocumentDraft d){Prepare(app,d);}
  public CreationReceipt Apply(string id,bool approved,CancellationToken token){
   if(consumed||id!=plan.Id)throw new OfficeFault("invalid_plan");consumed=true;
   var result=new CreationReceipt{PlanId=id,Status="rejected"};if(!approved)return result;
   string stage="source_check";
   try{token.ThrowIfCancellationRequested();port.CheckSource();token.ThrowIfCancellationRequested();stage="create_document";result.Mutated=true;port.Create(Wire.Clone(plan),token);result.Document=port.CreatedName;token.ThrowIfCancellationRequested();stage="readback";if(Wire.Hash(port.ReadCreated())!=Wire.Hash(plan.Content))throw new OfficeFault("readback_mismatch");result.Status="verified";result.Count=plan.Content.Paragraphs?.Count??plan.Content.Slides?.Count??plan.Content.Sheets.Count;}
   catch(OperationCanceledException){result.Status=result.Mutated?"partial":"cancelled";result.Error="cancelled";}
   catch(OfficeFault e){if(stage=="create_document"&&e.InvocationStarted==false&&port is IDocumentCreationState state&&!state.CreatedDocumentExists)result.Mutated=false;result.Status=result.Mutated?"partial":"conflict";result.Error=e.Message;result.FailedMember=e.Member;result.NativeCode=e.NativeCode;result.ExceptionName=e.ExceptionName;result.FailureStage=stage;}
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
