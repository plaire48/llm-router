using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 // All access is on the Office UI thread. Never parse or reopen the document externally.
 sealed class TextPort : ITextPort, IDisposable {
  readonly dynamic application;readonly string app;readonly int hwnd;
  object document,target;string documentId,targetId;int start,end;
  sealed class ComScope:IDisposable {readonly List<object> values=new List<object>();public dynamic Keep(object value){if(value!=null&&Marshal.IsComObject(value))values.Add(value);return value;}public void Dispose(){for(int i=values.Count-1;i>=0;i--)Marshal.ReleaseComObject(values[i]);}}
  public TextPort(object application,string app,int hwnd){this.application=application;this.app=app;this.hwnd=hwnd;}
  static string Identity(object value){var p=Marshal.GetIUnknownForObject(value);try{return p.ToInt64().ToString();}finally{Marshal.Release(p);}}
  void Active(ComScope scope){dynamic win=scope.Keep(application.ActiveWindow);if(win==null||(int)win.HWND!=hwnd)throw new OfficeFault("activate_source_window");dynamic doc=scope.Keep(app=="word"?application.ActiveDocument:application.ActivePresentation);if(document!=null&&Identity(doc)!=documentId)throw new OfficeFault("source_changed");}
  public TextSnapshot Capture(){Dispose();using(var scope=new ComScope()){
   Active(scope);document=app=="word"?application.ActiveDocument:application.ActivePresentation;documentId=Identity(document);
   dynamic win=scope.Keep(application.ActiveWindow);dynamic selection=scope.Keep(win.Selection);
   if(app=="word"){target=selection.Range;dynamic range=target;if((int)range.StoryType!=1)throw new OfficeFault("select_text");start=(int)range.Start;end=(int)range.End;targetId=start+":"+end;}
   else {dynamic shapes=scope.Keep(selection.ShapeRange);if((int)shapes.Count!=1)throw new OfficeFault("select_text");target=shapes.Item(1);dynamic shape=target;targetId=Convert.ToString(shape.Id);}
   return Snapshot(scope);
  }}
  public TextSnapshot Read(TextSnapshot binding){using(var scope=new ComScope()){Active(scope);if(binding.DocumentId!=documentId||binding.TargetId!=targetId)throw new OfficeFault("source_changed");return Snapshot(scope);}}
  static bool Plain(string value)=>!string.IsNullOrWhiteSpace(value)&&value.Length<=8000&&value.IndexOfAny(new[]{'\r','\n','\t','\a','\v','\f','\0'})<0;
  TextSnapshot Snapshot(ComScope scope){dynamic doc=document;dynamic range;string text,format,surrounding,location;bool editable;
   if(app=="word"){
    range=scope.Keep(doc.Range(start,end));text=(string)range.Text??"";
    dynamic content=scope.Keep(doc.Content),font=scope.Keep(range.Font),paragraph=scope.Keep(range.ParagraphFormat);
    dynamic before=scope.Keep(doc.Range(0,start)),after=scope.Keep(doc.Range(end,(int)content.End));
    // Mixed formatting is read-only; replacement never crosses a paragraph boundary.
    format=Wire.Hash(new {name=(string)font.Name,size=(float)font.Size,bold=(int)font.Bold,italic=(int)font.Italic,underline=(int)font.Underline,color=(int)font.Color,alignment=(int)paragraph.Alignment});
    bool uniform=(string)font.Name!=null&&(float)font.Size<999999&&(int)font.Bold!=9999999&&(int)font.Italic!=9999999&&(int)font.Underline!=9999999&&(int)font.Color!=9999999;
    dynamic tables=scope.Keep(range.Tables),fields=scope.Keep(range.Fields),inline=scope.Keep(range.InlineShapes),controls=scope.Keep(range.ContentControls),links=scope.Keep(range.Hyperlinks);
    editable=Plain(text)&&uniform&&(int)range.StoryType==1&&!(bool)doc.ReadOnly&&!(bool)doc.TrackRevisions&&(int)doc.ProtectionType==-1&&(int)tables.Count==0&&(int)fields.Count==0&&(int)inline.Count==0&&(int)controls.Count==0&&(int)links.Count==0;
    surrounding=Wire.Hash(new{before=(string)before.Text,after=(string)after.Text});location="선택한 문장";
   }else{
    dynamic shape=target;if((int)shape.HasTextFrame!=-1)throw new OfficeFault("select_text");dynamic frame=scope.Keep(shape.TextFrame);range=scope.Keep(frame.TextRange);text=(string)range.Text??"";
    dynamic font=scope.Keep(range.Font),color=scope.Keep(font.Color),paragraph=scope.Keep(range.ParagraphFormat),runs=scope.Keep(range.Runs(-1,-1));
    format=Wire.Hash(new{name=(string)font.Name,size=(float)font.Size,bold=(int)font.Bold,italic=(int)font.Italic,underline=(int)font.Underline,color=(int)color.RGB,alignment=(int)paragraph.Alignment,left=(float)shape.Left,top=(float)shape.Top,width=(float)shape.Width,height=(float)shape.Height,autoSize=(int)frame.AutoSize});
    dynamic slide=scope.Keep(shape.Parent),shapes=scope.Keep(slide.Shapes);var others=new List<object>();bool found=false;
    for(int i=1;i<=(int)shapes.Count;i++){dynamic other=scope.Keep(shapes.Item(i));if((int)other.Id==(int)shape.Id){found=true;continue;}string otherText="";if((int)other.HasTextFrame==-1){dynamic f=scope.Keep(other.TextFrame),r=scope.Keep(f.TextRange);otherText=(string)r.Text;}others.Add(new{id=(int)other.Id,text=otherText});}
    if(!found)throw new OfficeFault("source_changed");
    editable=Plain(text)&&(int)runs.Count==1&&(int)doc.ReadOnly!= -1&&(int)shape.Type!=6&&(int)frame.AutoSize==0;
    surrounding=Wire.Hash(others);location="슬라이드 "+(int)slide.SlideIndex+" / "+(string)shape.Name;
   }
   if(text.Length>8000)throw new OfficeFault("text_scope_invalid");
   return new TextSnapshot{App=app,DocumentId=documentId,TargetId=targetId,Document=(string)doc.Name,Location=location,Text=text,Editable=editable,FormatHash=format,SurroundingHash=surrounding};
  }
  public void Replace(TextSnapshot binding,string text){using(var scope=new ComScope()){Active(scope);var current=Snapshot(scope);if(!current.Editable)throw new OfficeFault("text_format_unsupported");if(app=="word"){dynamic doc=document,range=scope.Keep(doc.Range(start,end));range.Text=text;end=start+text.Length;}else{dynamic shape=target,frame=scope.Keep(shape.TextFrame),range=scope.Keep(frame.TextRange);range.Text=text;}}}
  public void Dispose(){if(target!=null&&Marshal.IsComObject(target))Marshal.ReleaseComObject(target);if(document!=null&&Marshal.IsComObject(document))Marshal.ReleaseComObject(document);target=null;document=null;documentId=null;targetId=null;}
 }
}
