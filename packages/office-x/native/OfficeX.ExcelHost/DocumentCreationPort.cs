using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 // New unsaved Office documents only. All COM access remains on the pane's STA thread.
 sealed class DocumentCreationPort:IDocumentCreationPort,IDisposable {
  readonly dynamic application;readonly string app;readonly int hwnd;readonly string sourceId;
  object created;CreationPlan plan;
  readonly List<Tuple<int,int>> wordRanges=new List<Tuple<int,int>>();
  readonly List<int> wordTables=new List<int>();
  static readonly Dictionary<string,int> Styles=new Dictionary<string,int>{{"Normal",-1},{"Title",-63},{"Heading1",-2},{"Heading2",-3}};
  sealed class Scope:IDisposable {readonly List<object> all=new List<object>();public dynamic Keep(object o){if(o!=null&&Marshal.IsComObject(o))all.Add(o);return o;}public void Dispose(){for(int i=all.Count-1;i>=0;i--)Marshal.ReleaseComObject(all[i]);}}
  static string Identity(object o){var p=Marshal.GetIUnknownForObject(o);try{return p.ToInt64().ToString();}finally{Marshal.Release(p);}}
  public DocumentCreationPort(object application,string app,int hwnd){this.application=application;this.app=app;this.hwnd=hwnd;using(var c=new Scope()){dynamic doc=c.Keep(Source());sourceId=Identity(doc);}}
  object Source()=>OfficeDispatch.Get((object)application,app=="word"?"ActiveDocument":app=="powerpoint"?"ActivePresentation":"ActiveWorkbook");
  public void CheckSource(){using(var c=new Scope()){dynamic win=c.Keep(application.ActiveWindow),doc=c.Keep(Source());if((int)win.HWND!=hwnd||Identity(doc)!=sourceId)throw new OfficeFault("activate_source_window");}}
  public string CreatedName=>created==null?null:(string)((dynamic)created).Name;
  public void ActivateCreated(){if(created==null)throw new OfficeFault("document_closed");using(var c=new Scope()){dynamic doc=created;if(app=="powerpoint"){dynamic windows=c.Keep(doc.Windows),window=c.Keep(windows.Item(1));window.Activate();}else doc.Activate();}}
  public void Create(CreationPlan value,CancellationToken token){
   if(created!=null)throw new OfficeFault("writes_stopped_for_this_run");plan=Wire.Clone(value);
   using(var c=new Scope()){
    dynamic collection=c.Keep(app=="word"?application.Documents:app=="powerpoint"?application.Presentations:application.Workbooks);
    created=OfficeDispatch.Invoke((object)collection,"Add","call",app=="word"?new object[0]:new object[]{app=="powerpoint"?-1:-4167});
    dynamic doc=created,properties=c.Keep(doc.BuiltInDocumentProperties),title=c.Keep(properties.Item("Title"));title.Value=plan.Content.Title;
    if(app=="word")CreateWord(c,doc,token);else if(app=="powerpoint")CreateSlides(c,doc,token);else CreateSheets(c,doc,token);
   }
  }
  void CreateWord(Scope c,dynamic doc,CancellationToken token){
   foreach(var part in plan.Content.Paragraphs){token.ThrowIfCancellationRequested();dynamic content=c.Keep(doc.Content);int start=(int)content.End-1;dynamic range=c.Keep(doc.Range(start,start));
    if(part.Rows==null){range.Text=part.Text+"\r";dynamic written=c.Keep(doc.Range(start,start+part.Text.Length));written.Style=Styles[part.Style];wordRanges.Add(Tuple.Create(start,start+part.Text.Length));wordTables.Add(0);}
    else{dynamic tables=c.Keep(doc.Tables),table=c.Keep(tables.Add(range,part.Rows.Count,part.Rows[0].Count));
     for(int r=0;r<part.Rows.Count;r++)for(int col=0;col<part.Rows[r].Count;col++){dynamic cell=c.Keep(table.Cell(r+1,col+1)),text=c.Keep(cell.Range);text.Text=part.Rows[r][col];}
     dynamic borders=c.Keep(table.Borders),rows=c.Keep(table.Rows),header=c.Keep(rows.Item(1)),hr=c.Keep(header.Range),font=c.Keep(hr.Font);borders.Enable=1;header.HeadingFormat=-1;font.Bold=-1;table.AutoFitBehavior(2);wordRanges.Add(null);wordTables.Add((int)tables.Count);
    }
   }
  }
  static void Box(Scope c,dynamic shapes,string text,float top,float height,bool heading){
   dynamic shape=c.Keep(shapes.AddTextbox(1,54f,top,852f,height)),frame=c.Keep(shape.TextFrame),range=c.Keep(frame.TextRange);range.Text=text;
   frame.WordWrap=-1;frame.AutoSize=0;dynamic font=c.Keep(range.Font),color=c.Keep(font.Color);font.Name="맑은 고딕";font.Size=heading?32f:24f;font.Bold=heading?-1:0;color.RGB=heading?0xBD6421:0x333333;
   while((float)range.BoundHeight>height-12&&(float)font.Size>16)font.Size=(float)font.Size-1;
   if((float)range.BoundHeight>height-12)throw new OfficeFault("slide_text_overflow");
  }
  void CreateSlides(Scope c,dynamic doc,CancellationToken token){
   dynamic setup=c.Keep(doc.PageSetup);setup.SlideWidth=960f;setup.SlideHeight=540f;dynamic slides=c.Keep(doc.Slides);
   foreach(var item in plan.Content.Slides){token.ThrowIfCancellationRequested();dynamic slide=c.Keep(slides.Add((int)slides.Count+1,12)),shapes=c.Keep(slide.Shapes);Box(c,shapes,item.Title,38,86,true);Box(c,shapes,string.Join("\r",item.Body),145,340,false);}
  }
  void CreateSheets(Scope c,dynamic doc,CancellationToken token){
   dynamic sheets=c.Keep(doc.Worksheets);
   while((int)sheets.Count<plan.Content.Sheets.Count){dynamic last=c.Keep(sheets.Item((int)sheets.Count));c.Keep(sheets.Add(After:last));}
   for(int i=1;i<=(int)sheets.Count;i++){dynamic sheet=c.Keep(sheets.Item(i));sheet.Name="Nubi_"+Guid.NewGuid().ToString("N").Substring(0,12);}
   for(int i=0;i<plan.Content.Sheets.Count;i++){token.ThrowIfCancellationRequested();var item=plan.Content.Sheets[i];dynamic sheet=c.Keep(sheets.Item(i+1));sheet.Name=item.Name;
    dynamic range=c.Keep(sheet.Range["A1",Region.CellAddress(item.Rows.Count,item.Rows[0].Count)]);range.NumberFormat="@";var values=new object[item.Rows.Count,item.Rows[0].Count];
    for(int r=0;r<item.Rows.Count;r++)for(int col=0;col<item.Rows[r].Count;col++)values[r,col]=item.Rows[r][col];range.Value2=values;
    dynamic head=c.Keep(sheet.Range["A1",Region.CellAddress(1,item.Rows[0].Count)]),font=c.Keep(head.Font),fill=c.Keep(head.Interior),columns=c.Keep(range.Columns);font.Bold=true;fill.Color=0xF8EFE6;columns.ColumnWidth=20;range.WrapText=true;dynamic rows=c.Keep(range.Rows);rows.AutoFit();
   }
  }
  public DocumentDraft ReadCreated(){using(var c=new Scope()){
   dynamic doc=created,properties=c.Keep(doc.BuiltInDocumentProperties),title=c.Keep(properties.Item("Title"));var actual=new DocumentDraft{Title=Convert.ToString(title.Value)};
   if(app=="word"){
    actual.Paragraphs=new List<DocumentPart>();
    for(int i=0;i<wordRanges.Count;i++){
     if(wordRanges[i]!=null){var bounds=wordRanges[i];dynamic range=c.Keep(doc.Range(bounds.Item1,bounds.Item2)),style=c.Keep(range.Style),styles=c.Keep(doc.Styles);string name=(string)style.NameLocal;string found=null;
      foreach(var pair in Styles){dynamic candidate=c.Keep(styles.Item(pair.Value));if((string)candidate.NameLocal==name){found=pair.Key;break;}}
      actual.Paragraphs.Add(new DocumentPart{Text=(string)range.Text??"",Style=found});
     }else{dynamic tables=c.Keep(doc.Tables),table=c.Keep(tables.Item(wordTables[i])),rows=c.Keep(table.Rows),columns=c.Keep(table.Columns);var values=new List<List<string>>();for(int r=1;r<=(int)rows.Count;r++){var cells=new List<string>();for(int col=1;col<=(int)columns.Count;col++){dynamic cell=c.Keep(table.Cell(r,col)),range=c.Keep(cell.Range);cells.Add(((string)range.Text??"").TrimEnd('\r','\a'));}values.Add(cells);}actual.Paragraphs.Add(new DocumentPart{Rows=values});}
    }
   }else if(app=="powerpoint"){
    actual.Slides=new List<SlideContent>();dynamic slides=c.Keep(doc.Slides);
    for(int i=1;i<=(int)slides.Count;i++){dynamic slide=c.Keep(slides.Item(i)),shapes=c.Keep(slide.Shapes),a=c.Keep(shapes.Item(1)),b=c.Keep(shapes.Item(2)),af=c.Keep(a.TextFrame),bf=c.Keep(b.TextFrame),at=c.Keep(af.TextRange),bt=c.Keep(bf.TextRange);string body=(string)bt.Text??"";actual.Slides.Add(new SlideContent{Title=(string)at.Text??"",Body=body.Length==0?new List<string>():body.Split('\r').ToList()});}
   }else{
    actual.Sheets=new List<SheetContent>();dynamic sheets=c.Keep(doc.Worksheets);
    for(int i=1;i<=(int)sheets.Count;i++){dynamic sheet=c.Keep(sheets.Item(i));var expected=plan.Content.Sheets[i-1];dynamic range=c.Keep(sheet.Range["A1",Region.CellAddress(expected.Rows.Count,expected.Rows[0].Count)]);object raw=range.Value2;var values=raw as Array;var rows=new List<List<string>>();for(int r=0;r<expected.Rows.Count;r++){var row=new List<string>();for(int col=0;col<expected.Rows[r].Count;col++)row.Add(Convert.ToString(values==null?raw:values.GetValue(r+values.GetLowerBound(0),col+values.GetLowerBound(1)))??"");rows.Add(row);}actual.Sheets.Add(new SheetContent{Name=(string)sheet.Name,Rows=rows});}
   }
   return actual;
  }}
  public void Dispose(){if(created!=null&&Marshal.IsComObject(created))Marshal.ReleaseComObject(created);created=null;}
 }
}
