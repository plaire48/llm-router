using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using OfficeX.Core;

namespace OfficeX.ExcelHost {
 // UI-thread COM only. Bound document objects never fall back to another active document.
 sealed class TextPort : ITextPort, ITextBatchPort, IDisposable {
  readonly dynamic application; readonly string app; readonly int hwnd;
  object document,slide; readonly List<object> shapes=new List<object>();
  string documentId,targetId; int start,end;
  sealed class ComScope:IDisposable {
   readonly List<object> values=new List<object>();
   public dynamic Keep(object value){if(value!=null&&Marshal.IsComObject(value))values.Add(value);return value;}
   public void Dispose(){for(int i=values.Count-1;i>=0;i--)Marshal.ReleaseComObject(values[i]);}
  }
  sealed class Slot {public TextBlock Block;public int Start,Length;public object Shape;}
  public TextPort(object application,string app,int hwnd){this.application=application;this.app=app;this.hwnd=hwnd;}
  static string Identity(object value){var p=Marshal.GetIUnknownForObject(value);try{return p.ToInt64().ToString();}finally{Marshal.Release(p);}}
  void Active(ComScope scope){
   dynamic win=scope.Keep(application.ActiveWindow);
   if(win==null||(int)win.HWND!=hwnd)throw new OfficeFault("activate_source_window");
   dynamic doc=scope.Keep(app=="word"?application.ActiveDocument:application.ActivePresentation);
   if(document!=null&&Identity(doc)!=documentId)throw new OfficeFault("source_changed");
  }
  public TextSnapshot Capture(){
   Dispose();using(var scope=new ComScope()){
    Active(scope);document=app=="word"?application.ActiveDocument:application.ActivePresentation;documentId=Identity(document);
    dynamic win=scope.Keep(application.ActiveWindow),selection=scope.Keep(win.Selection);
    if(app=="word"){
     dynamic range=scope.Keep(selection.Range);
     if((int)range.StoryType!=1)throw new OfficeFault("select_text");
     start=(int)range.Start;end=(int)range.End;
     if(start==end){dynamic paragraphs=scope.Keep(range.Paragraphs),p=scope.Keep(paragraphs.Item(1)),r=scope.Keep(p.Range);start=(int)r.Start;end=(int)r.End;}
     targetId=start+":"+end;
    }else{
     dynamic view=scope.Keep(win.View);slide=view.Slide;
     dynamic candidates;
     if((int)selection.Type==2||(int)selection.Type==3)candidates=scope.Keep(selection.ShapeRange);
     else candidates=scope.Keep(((dynamic)slide).Shapes);
     for(int i=1;i<=(int)candidates.Count;i++){
      dynamic shape=candidates.Item(i);
      if((int)shape.HasTextFrame==-1)shapes.Add(shape);else Marshal.ReleaseComObject(shape);
     }
     if(shapes.Count<1||shapes.Count>30)throw new OfficeFault("select_text");
     targetId=Convert.ToString(((dynamic)slide).SlideID)+":"+string.Join(",",shapes.Select(s=>Convert.ToString(((dynamic)s).Id)));
    }
    return Snapshot(scope);
   }
  }
  public TextSnapshot Read(TextSnapshot binding){using(var scope=new ComScope()){Active(scope);CheckBinding(binding);return Snapshot(scope);}}
  void CheckBinding(TextSnapshot binding){if(binding.DocumentId!=documentId||binding.TargetId!=targetId)throw new OfficeFault("source_changed");}
  static bool Plain(string text)=>!string.IsNullOrWhiteSpace(text)&&text.Length<=8000&&text.IndexOfAny(new[]{'\r','\n','\t','\a','\v','\f','\0'})<0;
  TextBlock WordBlock(ComScope scope,dynamic range,string id){
   dynamic doc=document,font=scope.Keep(range.Font),paragraph=scope.Keep(range.ParagraphFormat);
   var text=(string)range.Text??"";
   var format=Wire.Hash(new{name=(string)font.Name,size=(float)font.Size,bold=(int)font.Bold,italic=(int)font.Italic,underline=(int)font.Underline,color=(int)font.Color,smallCaps=(int)font.SmallCaps,allCaps=(int)font.AllCaps,strike=(int)font.StrikeThrough,doubleStrike=(int)font.DoubleStrikeThrough,subscript=(int)font.Subscript,superscript=(int)font.Superscript,hidden=(int)font.Hidden,spacing=(float)font.Spacing,scaling=(int)font.Scaling,position=(float)font.Position,highlight=(int)range.HighlightColorIndex,language=(int)range.LanguageID,alignment=(int)paragraph.Alignment});
   bool uniform=!string.IsNullOrWhiteSpace((string)font.Name)&&(float)font.Size<999999&&(int)font.Bold!=9999999&&(int)font.Italic!=9999999&&(int)font.Underline!=9999999&&(int)font.Color!=9999999;
   uniform=uniform&&(int)font.SmallCaps!=9999999&&(int)font.AllCaps!=9999999&&(int)font.StrikeThrough!=9999999&&(int)font.DoubleStrikeThrough!=9999999&&(int)font.Subscript!=9999999&&(int)font.Superscript!=9999999&&(int)font.Hidden!=9999999&&(float)font.Spacing<999999&&(int)font.Scaling!=9999999&&(float)font.Position<999999&&(int)range.HighlightColorIndex!=9999999&&(int)range.LanguageID!=9999999;
   dynamic revisions=scope.Keep(range.Revisions),parentControl=scope.Keep(range.ParentContentControl),tables=scope.Keep(range.Tables),fields=scope.Keep(range.Fields),inline=scope.Keep(range.InlineShapes),controls=scope.Keep(range.ContentControls),links=scope.Keep(range.Hyperlinks);
   bool editable=Plain(text)&&uniform&&(int)revisions.Count==0&&parentControl==null&&!(bool)doc.ReadOnly&&!(bool)doc.TrackRevisions&&(int)doc.ProtectionType==-1&&(int)tables.Count==0&&(int)fields.Count==0&&(int)inline.Count==0&&(int)controls.Count==0&&(int)links.Count==0;
   return new TextBlock{Id=id,Label="문단 "+id.Substring(1),Text=text,FormatHash=format,Editable=editable};
  }
  TextBlock SlideBlock(ComScope scope,dynamic shape,dynamic range,string id,int paragraphIndex){
   dynamic doc=document,frame=scope.Keep(shape.TextFrame),font=scope.Keep(range.Font),color=scope.Keep(font.Color),paragraph=scope.Keep(range.ParagraphFormat),bullet=scope.Keep(paragraph.Bullet),runs=scope.Keep(range.Runs(-1,-1));
   var text=(string)range.Text??"";
   var format=Wire.Hash(new{name=(string)font.Name,size=(float)font.Size,bold=(int)font.Bold,italic=(int)font.Italic,underline=(int)font.Underline,color=(int)color.RGB,alignment=(int)paragraph.Alignment,bullet=(int)bullet.Type,indent=(int)range.IndentLevel,left=(float)shape.Left,top=(float)shape.Top,width=(float)shape.Width,height=(float)shape.Height,autoSize=(int)frame.AutoSize});
   return new TextBlock{Id=id,Label=(string)shape.Name+" / 문단 "+paragraphIndex,Text=text,FormatHash=format,Editable=Plain(text)&&(int)runs.Count==1&&(int)doc.ReadOnly!=-1&&(int)shape.Type!=6&&(int)frame.AutoSize==0};
  }
  List<Slot> Slots(ComScope scope){
   var slots=new List<Slot>();dynamic doc=document;
   if(app=="word"){
    dynamic range=scope.Keep(doc.Range(start,end)),paragraphs=scope.Keep(range.Paragraphs);
    if((int)paragraphs.Count>30)throw new OfficeFault("text_block_limit");
    for(int i=1;i<=(int)paragraphs.Count;i++){
     dynamic p=scope.Keep(paragraphs.Item(i)),r=scope.Keep(p.Range);int a=Math.Max(start,(int)r.Start),b=Math.Min(end,(int)r.End);
     if(b<=a)continue;
     dynamic selected=scope.Keep(doc.Range(a,b));string text=(string)selected.Text??"";
     // Paragraph separators remain in Office; the model cannot replace them.
     if(text.EndsWith("\r",StringComparison.Ordinal)){b--;selected=scope.Keep(doc.Range(a,b));}
     slots.Add(new Slot{Start=a,Length=b-a,Block=WordBlock(scope,selected,"p"+i)});
    }
   }else{
    dynamic currentSlide=slide,all=scope.Keep(currentSlide.Shapes);var ids=new HashSet<int>();
    for(int i=1;i<=(int)all.Count;i++){dynamic s=scope.Keep(all.Item(i));ids.Add((int)s.Id);}
    foreach(dynamic shape in shapes){
     if(!ids.Contains((int)shape.Id))throw new OfficeFault("source_changed");
     dynamic frame=scope.Keep(shape.TextFrame),range=scope.Keep(frame.TextRange),paragraphs=scope.Keep(range.Paragraphs(-1,-1));
     if((int)paragraphs.Count+slots.Count>30)throw new OfficeFault("text_block_limit");
     for(int i=1;i<=(int)paragraphs.Count;i++){
      dynamic p=scope.Keep(range.Paragraphs(i,1));int a=(int)p.Start,length=(int)p.Length;string text=(string)p.Text??"";
      if(text.EndsWith("\r",StringComparison.Ordinal))length--;
      dynamic selected=length>0?scope.Keep(range.Characters(a,length)):p;
      slots.Add(new Slot{Shape=shape,Start=a,Length=length,Block=SlideBlock(scope,shape,selected,"s"+shape.Id+"p"+i,i)});
     }
    }
   }
   if(slots.Count<1||slots.Sum(s=>s.Block.Text.Length)+Math.Max(0,slots.Count-1)>8000)throw new OfficeFault("text_scope_invalid");
   return slots;
  }
  TextSnapshot Snapshot(ComScope scope){
   dynamic doc=document;var slots=Slots(scope);string surrounding,location;
   if(app=="word"){
    dynamic content=scope.Keep(doc.Content),before=scope.Keep(doc.Range(0,start)),after=scope.Keep(doc.Range(end,(int)content.End));
    surrounding=Wire.Hash(new{before=(string)before.Text,after=(string)after.Text});location="선택한 문단 "+slots.Count+"개";
   }else{
    dynamic currentSlide=slide,all=scope.Keep(currentSlide.Shapes);var selected=new HashSet<int>(shapes.Select(s=>(int)((dynamic)s).Id));var others=new List<object>();
    for(int i=1;i<=(int)all.Count;i++){dynamic shape=scope.Keep(all.Item(i));if(selected.Contains((int)shape.Id))continue;string text="";if((int)shape.HasTextFrame==-1){dynamic f=scope.Keep(shape.TextFrame),r=scope.Keep(f.TextRange);text=(string)r.Text;}others.Add(new{id=(int)shape.Id,text});}
    surrounding=Wire.Hash(others);location="슬라이드 "+currentSlide.SlideIndex+" / 텍스트 상자 "+shapes.Count+"개";
   }
   var blocks=slots.Select(s=>s.Block).ToList();return new TextSnapshot{App=app,DocumentId=documentId,TargetId=targetId,Document=(string)doc.Name,Location=location,Blocks=blocks,Text=string.Join("\n",blocks.Select(b=>b.Text)),Editable=blocks.Count==1&&blocks[0].Editable,FormatHash=Wire.Hash(blocks.Select(b=>new{b.Id,b.FormatHash}).ToArray()),SurroundingHash=surrounding};
  }
  public void Replace(TextSnapshot binding,string text){using(var scope=new ComScope()){var live=Read(binding);if(!live.Editable)throw new OfficeFault("text_format_unsupported");ReplaceBlocks(binding,new[]{new TextOperation{BlockId=live.Blocks[0].Id,Text=text}});}}
  public void ReplaceBlocks(TextSnapshot binding,IReadOnlyList<TextOperation> operations){
   using(var scope=new ComScope()){
    Active(scope);CheckBinding(binding);var slots=Slots(scope);
    var writes=operations.Select(op=>new {Operation=op,Slot=slots.SingleOrDefault(s=>s.Block.Id==op.BlockId)}).ToList();
    if(writes.Any(w=>w.Slot==null||!w.Slot.Block.Editable))throw new OfficeFault("text_format_unsupported");
    // Descending offsets keep every later paragraph anchored to its observed position.
    foreach(var write in writes.OrderByDescending(w=>w.Slot.Start)){
     dynamic range;
     if(app=="word"){dynamic doc=document;range=scope.Keep(doc.Range(write.Slot.Start,write.Slot.Start+write.Slot.Length));range.Text=write.Operation.Text;end+=write.Operation.Text.Length-write.Slot.Length;}
     else{dynamic shape=write.Slot.Shape,frame=scope.Keep(shape.TextFrame),text=scope.Keep(frame.TextRange);range=scope.Keep(text.Characters(write.Slot.Start,write.Slot.Length));range.Text=write.Operation.Text;}
    }
   }
  }
  public object ReadOutline(){
   using(var scope=new ComScope()){
    Active(scope);dynamic doc=document;var items=new List<object>();int total=0,budget=12000,seen=0;
    if(app=="word"){
     dynamic paragraphs=scope.Keep(doc.Paragraphs);total=(int)paragraphs.Count;
     for(int i=1;i<=Math.Min(total,200)&&budget>0;i++){
      dynamic p=scope.Keep(paragraphs.Item(i)),r=scope.Keep(p.Range);string text=((string)r.Text??"").TrimEnd('\r');bool clipped=text.Length>budget;text=text.Substring(0,Math.Min(text.Length,budget));budget-=text.Length;items.Add(new{paragraph=i,level=(int)p.OutlineLevel,text});seen=i;if(clipped)break;
     }
    }else{
     dynamic slides=scope.Keep(doc.Slides);total=(int)slides.Count;
     for(int i=1;i<=Math.Min(total,60)&&budget>0;i++){
      dynamic current=scope.Keep(slides.Item(i)),all=scope.Keep(current.Shapes);var texts=new List<string>();bool clipped=false;
      for(int j=1;j<=(int)all.Count;j++){if(budget<=0){clipped=true;break;}dynamic shape=scope.Keep(all.Item(j));if((int)shape.HasTextFrame!=-1)continue;dynamic frame=scope.Keep(shape.TextFrame),r=scope.Keep(frame.TextRange);string text=(string)r.Text??"";clipped|=text.Length>budget;text=text.Substring(0,Math.Min(text.Length,budget));budget-=text.Length;texts.Add(text);}
      items.Add(new{slide=i,texts});seen=i;if(clipped)break;
     }
    }
    return new{app,document=(string)doc.Name,documentId,total,items,truncated=seen<total||budget<=0,readOnly=true};
   }
  }
  static void Release(object value){if(value!=null&&Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
  public void Dispose(){foreach(var shape in shapes)Release(shape);shapes.Clear();Release(slide);Release(document);slide=null;document=null;documentId=null;targetId=null;}
 }
}
