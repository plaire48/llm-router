using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 // New unsaved Office documents only. All COM access remains on the pane's STA thread.
 sealed class DocumentCreationPort:IDocumentCreationPort,IDocumentCreationState,IDisposable {
  readonly object application;readonly string app;readonly int hwnd;readonly string sourceId;
  object created;CreationPlan plan;
  readonly List<Tuple<int,int>> wordRanges=new List<Tuple<int,int>>();
  readonly List<int> wordTables=new List<int>();
  static readonly Dictionary<string,int> Styles=new Dictionary<string,int>{{"Normal",-1},{"Title",-63},{"Heading1",-2},{"Heading2",-3}};
  sealed class Scope:IDisposable {readonly List<object> all=new List<object>();public object Hold(object o){if(o!=null&&Marshal.IsComObject(o))all.Add(o);return o;}public dynamic Keep(object o)=>Hold(o);public void Dispose(){for(int i=all.Count-1;i>=0;i--)Marshal.ReleaseComObject(all[i]);}}
  static string Identity(object o){var p=Marshal.GetIUnknownForObject(o);try{return p.ToInt64().ToString();}finally{Marshal.Release(p);}}
  public DocumentCreationPort(object application,string app,int hwnd){this.application=application;this.app=app;this.hwnd=hwnd;using(var c=new Scope()){object doc=c.Hold(Source());sourceId=Identity(doc);}}
  object Source()=>OfficeDispatch.Get((object)application,app=="word"?"ActiveDocument":app=="powerpoint"?"ActivePresentation":"ActiveWorkbook");
  public void CheckSource(){using(var c=new Scope()){object win=c.Hold(OfficeDispatch.Get((object)application,"ActiveWindow")),doc=c.Hold(Source());if(Convert.ToInt32(OfficeDispatch.Get(win,"HWND"))!=hwnd||Identity(doc)!=sourceId)throw new OfficeFault("activate_source_window");}}
  public bool CreatedDocumentExists=>created!=null;
  public string CreatedName=>created==null?null:Convert.ToString(OfficeDispatch.Get(created,"Name"));
  public string CreatedDocumentId=>created==null?null:Identity(created);
  public void ActivateCreated(){if(created==null)throw new OfficeFault("document_closed");using(var c=new Scope()){if(app=="powerpoint"){object windows=c.Hold(OfficeDispatch.Get(created,"Windows")),window=c.Hold(OfficeDispatch.Get(windows,"Item",1));OfficeDispatch.Call(window,"Activate");}else OfficeDispatch.Call(created,"Activate");}}
  public void Create(CreationPlan value,CancellationToken token){
   if(created!=null)throw new OfficeFault("writes_stopped_for_this_run");plan=Wire.Clone(value);
   using(var c=new Scope()){
    object collection=c.Hold(OfficeDispatch.Get((object)application,app=="word"?"Documents":app=="powerpoint"?"Presentations":"Workbooks"));
    created=OfficeDispatch.Invoke((object)collection,"Add","call",app=="word"?new object[0]:new object[]{app=="powerpoint"?-1:-4167});
    object properties=c.Hold(OfficeDispatch.Get(created,"BuiltInDocumentProperties")),title=c.Hold(OfficeDispatch.Get(properties,"Item","Title"));OfficeDispatch.Set(title,"Value",plan.Content.Title);
    if(app=="word")CreateWord(c,created,token);else if(app=="powerpoint")CreateSlides(c,created,token);else CreateSheets(c,created,token);
   }
  }
  static object Get(Scope c,object target,string member,params object[] args)=>c.Hold(OfficeDispatch.Get(target,member,args));
  void CreateWord(Scope c,object doc,CancellationToken token){
   foreach(var part in plan.Content.Paragraphs){token.ThrowIfCancellationRequested();object content=Get(c,doc,"Content");int start=Convert.ToInt32(OfficeDispatch.Get(content,"End"))-1;object range=Get(c,doc,"Range",start,start);
    if(part.Rows==null){OfficeDispatch.Set(range,"Text",part.Text+"\r");object written=Get(c,doc,"Range",start,start+part.Text.Length);OfficeDispatch.Set(written,"Style",Styles[part.Style]);wordRanges.Add(Tuple.Create(start,start+part.Text.Length));wordTables.Add(0);}
    else{object tables=Get(c,doc,"Tables"),table=c.Hold(OfficeDispatch.Call(tables,"Add",range,part.Rows.Count,part.Rows[0].Count));
     for(int r=0;r<part.Rows.Count;r++)for(int col=0;col<part.Rows[r].Count;col++){object cell=Get(c,table,"Cell",r+1,col+1),text=Get(c,cell,"Range");OfficeDispatch.Set(text,"Text",part.Rows[r][col]);}
     object borders=Get(c,table,"Borders"),rows=Get(c,table,"Rows"),header=Get(c,rows,"Item",1),hr=Get(c,header,"Range"),font=Get(c,hr,"Font");OfficeDispatch.Set(borders,"Enable",1);OfficeDispatch.Set(header,"HeadingFormat",-1);OfficeDispatch.Set(font,"Bold",-1);OfficeDispatch.Call(table,"AutoFitBehavior",2);wordRanges.Add(null);wordTables.Add(Convert.ToInt32(OfficeDispatch.Get(tables,"Count")));
    }
   }
  }
  static void Box(Scope c,object shapes,string text,float top,float height,bool heading){
   object shape=c.Hold(OfficeDispatch.Call(shapes,"AddTextbox",1,54f,top,852f,height)),frame=Get(c,shape,"TextFrame"),range=Get(c,frame,"TextRange");OfficeDispatch.Set(range,"Text",text);
   OfficeDispatch.Set(frame,"WordWrap",-1);OfficeDispatch.Set(frame,"AutoSize",0);object font=Get(c,range,"Font"),color=Get(c,font,"Color");OfficeDispatch.Set(font,"Name","맑은 고딕");OfficeDispatch.Set(font,"Size",heading?32f:24f);OfficeDispatch.Set(font,"Bold",heading?-1:0);OfficeDispatch.Set(color,"RGB",heading?0xBD6421:0x333333);
   while(Convert.ToSingle(OfficeDispatch.Get(range,"BoundHeight"))>height-12&&Convert.ToSingle(OfficeDispatch.Get(font,"Size"))>16)OfficeDispatch.Set(font,"Size",Convert.ToSingle(OfficeDispatch.Get(font,"Size"))-1);
   if(Convert.ToSingle(OfficeDispatch.Get(range,"BoundHeight"))>height-12)throw new OfficeFault("slide_text_overflow");
  }
  void CreateSlides(Scope c,object doc,CancellationToken token){
   object setup=Get(c,doc,"PageSetup");OfficeDispatch.Set(setup,"SlideWidth",960f);OfficeDispatch.Set(setup,"SlideHeight",540f);object slides=Get(c,doc,"Slides");
   foreach(var item in plan.Content.Slides){token.ThrowIfCancellationRequested();object slide=c.Hold(OfficeDispatch.Call(slides,"Add",Convert.ToInt32(OfficeDispatch.Get(slides,"Count"))+1,12)),shapes=Get(c,slide,"Shapes");Box(c,shapes,item.Title,38,86,true);Box(c,shapes,string.Join("\r",item.Body),145,340,false);}
  }
  void CreateSheets(Scope c,object doc,CancellationToken token){
   object sheets=c.Hold(OfficeDispatch.Get(doc,"Worksheets"));
   int Count()=>Convert.ToInt32(OfficeDispatch.Get(sheets,"Count"));
   while(Count()<plan.Content.Sheets.Count){object last=c.Hold(OfficeDispatch.Get(sheets,"Item",Count()));c.Hold(OfficeDispatch.Call(sheets,"Add",Type.Missing,last));}
   for(int i=1;i<=Count();i++){object sheet=c.Hold(OfficeDispatch.Get(sheets,"Item",i));OfficeDispatch.Set(sheet,"Name","Nubi_"+Guid.NewGuid().ToString("N").Substring(0,12));}
   for(int i=0;i<plan.Content.Sheets.Count;i++){
    token.ThrowIfCancellationRequested();var item=plan.Content.Sheets[i];object sheet=c.Hold(OfficeDispatch.Get(sheets,"Item",i+1));OfficeDispatch.Set(sheet,"Name",item.Name);
    object range=c.Hold(OfficeDispatch.Get(sheet,"Range","A1",Region.CellAddress(item.Rows.Count,item.Rows[0].Count)));
    OfficeDispatch.Set(range,"NumberFormat","@");var values=new object[item.Rows.Count,item.Rows[0].Count];
    for(int r=0;r<item.Rows.Count;r++)for(int col=0;col<item.Rows[r].Count;col++)values[r,col]=item.Rows[r][col];
    OfficeDispatch.Set(range,"Value2",values);
    object head=c.Hold(OfficeDispatch.Get(sheet,"Range","A1",Region.CellAddress(1,item.Rows[0].Count))),font=c.Hold(OfficeDispatch.Get(head,"Font")),fill=c.Hold(OfficeDispatch.Get(head,"Interior")),columns=c.Hold(OfficeDispatch.Get(range,"Columns")),rows=c.Hold(OfficeDispatch.Get(range,"Rows"));
    OfficeDispatch.Set(font,"Bold",true);OfficeDispatch.Set(fill,"Color",0xF8EFE6);OfficeDispatch.Set(columns,"ColumnWidth",20);OfficeDispatch.Set(range,"WrapText",true);OfficeDispatch.Call(rows,"AutoFit");
   }
  }
  public DocumentDraft ReadCreated(){using(var c=new Scope()){
   object properties=c.Hold(OfficeDispatch.Get(created,"BuiltInDocumentProperties")),title=c.Hold(OfficeDispatch.Get(properties,"Item","Title"));var actual=new DocumentDraft{Title=Convert.ToString(OfficeDispatch.Get(title,"Value"))};object doc=created;
   if(app=="word"){
    actual.Paragraphs=new List<DocumentPart>();
    for(int i=0;i<wordRanges.Count;i++){
     if(wordRanges[i]!=null){var bounds=wordRanges[i];object range=Get(c,doc,"Range",bounds.Item1,bounds.Item2),style=Get(c,range,"Style"),styles=Get(c,doc,"Styles");string name=Convert.ToString(OfficeDispatch.Get(style,"NameLocal"));string found=null;
      foreach(var pair in Styles){object candidate=Get(c,styles,"Item",pair.Value);if(Convert.ToString(OfficeDispatch.Get(candidate,"NameLocal"))==name){found=pair.Key;break;}}
      actual.Paragraphs.Add(new DocumentPart{Text=Convert.ToString(OfficeDispatch.Get(range,"Text"))??"",Style=found});
     }else{object tables=Get(c,doc,"Tables"),table=Get(c,tables,"Item",wordTables[i]),rows=Get(c,table,"Rows"),columns=Get(c,table,"Columns");var values=new List<List<string>>();for(int r=1;r<=Convert.ToInt32(OfficeDispatch.Get(rows,"Count"));r++){var cells=new List<string>();for(int col=1;col<=Convert.ToInt32(OfficeDispatch.Get(columns,"Count"));col++){object cell=Get(c,table,"Cell",r,col),range=Get(c,cell,"Range");cells.Add((Convert.ToString(OfficeDispatch.Get(range,"Text"))??"").TrimEnd('\r','\a'));}values.Add(cells);}actual.Paragraphs.Add(new DocumentPart{Rows=values});}
    }
   }else if(app=="powerpoint"){
    actual.Slides=new List<SlideContent>();object slides=Get(c,doc,"Slides");
    for(int i=1;i<=Convert.ToInt32(OfficeDispatch.Get(slides,"Count"));i++){object slide=Get(c,slides,"Item",i),shapes=Get(c,slide,"Shapes"),a=Get(c,shapes,"Item",1),b=Get(c,shapes,"Item",2),af=Get(c,a,"TextFrame"),bf=Get(c,b,"TextFrame"),at=Get(c,af,"TextRange"),bt=Get(c,bf,"TextRange");string body=Convert.ToString(OfficeDispatch.Get(bt,"Text"))??"";actual.Slides.Add(new SlideContent{Title=Convert.ToString(OfficeDispatch.Get(at,"Text"))??"",Body=body.Length==0?new List<string>():body.Split('\r').ToList()});}
   }else{
    actual.Sheets=new List<SheetContent>();object sheets=c.Hold(OfficeDispatch.Get(created,"Worksheets"));
    for(int i=1;i<=Convert.ToInt32(OfficeDispatch.Get(sheets,"Count"));i++){
     object sheet=c.Hold(OfficeDispatch.Get(sheets,"Item",i));var expected=plan.Content.Sheets[i-1];object range=c.Hold(OfficeDispatch.Get(sheet,"Range","A1",Region.CellAddress(expected.Rows.Count,expected.Rows[0].Count)));object raw=OfficeDispatch.Get(range,"Value2");var values=raw as Array;var rows=new List<List<string>>();
     for(int r=0;r<expected.Rows.Count;r++){var row=new List<string>();for(int col=0;col<expected.Rows[r].Count;col++)row.Add(Convert.ToString(values==null?raw:values.GetValue(r+values.GetLowerBound(0),col+values.GetLowerBound(1)))??"");rows.Add(row);}
     actual.Sheets.Add(new SheetContent{Name=Convert.ToString(OfficeDispatch.Get(sheet,"Name")),Rows=rows});
    }
   }
   return actual;
  }}
  public void Dispose(){if(created!=null&&Marshal.IsComObject(created))Marshal.ReleaseComObject(created);created=null;}
 }
}
