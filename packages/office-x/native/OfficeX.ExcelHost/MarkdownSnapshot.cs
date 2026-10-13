using System;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 // No Save/SaveCopyAs, mutation, calculation or type-library reflection.
 // All COM references stay on the pane's STA thread and are released here.
 internal static class MarkdownSnapshot {
  static void Release(object value){if(value!=null&&Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
  static string Text(object target,string member)=>Convert.ToString(OfficeDispatch.Get(target,member),System.Globalization.CultureInfo.InvariantCulture)??"";
  static int Int(object target,string member)=>Convert.ToInt32(OfficeDispatch.Get(target,member));
  static object At(object value,int row,int col){if(value is Array a&&a.Rank==2)return a.GetValue(a.GetLowerBound(0)+row,a.GetLowerBound(1)+col);return row==0&&col==0?value:null;}
  static string Column(int n){string s="";while(n>0){n--;s=(char)('A'+n%26)+s;n/=26;}return s;}
  public static JObject Read(OfficeAutomationPort binding,CancellationToken token)=>ReadCore(binding,token,null).GetAwaiter().GetResult();
  public static Task<JObject> ReadAsync(OfficeAutomationPort binding,CancellationToken token){int owner=Thread.CurrentThread.ManagedThreadId;return ReadCore(binding,token,async()=>{await Task.Yield();token.ThrowIfCancellationRequested();if(Thread.CurrentThread.ManagedThreadId!=owner)throw new OfficeFault("office_thread_required",invocationStarted:false);});}
  static async Task<JObject> ReadCore(OfficeAutomationPort binding,CancellationToken token,Func<Task> pause){if(pause!=null)await pause();binding.CheckSource();token.ThrowIfCancellationRequested();object doc=binding.BoundDocument;
   var result=new JObject{{"kind",binding.App},{"name",binding.DocumentName},{"warnings",new JArray()}};
   if(binding.App=="word"){object content=null;try{content=OfficeDispatch.Get(doc,"Content");result["wordXml"]=Text(content,"WordOpenXML");}finally{Release(content);}}
   else if(binding.App=="excel")result["sheets"]=await Excel(doc,token,(JArray)result["warnings"],pause);
   else if(binding.App=="powerpoint")result["slides"]=await PowerPoint(doc,token,(JArray)result["warnings"],pause);
   else throw new OfficeFault("markdown_source_invalid",invocationStarted:false);
   binding.CheckSource();return result;
  }
  static async Task<JArray> Excel(object doc,CancellationToken token,JArray warnings,Func<Task> pause){object sheets=null;var result=new JArray();int cellBudget=200000;
   try{sheets=OfficeDispatch.Get(doc,"Worksheets");int total=Int(sheets,"Count");if(total>1000)throw new OfficeFault("markdown_source_limit",invocationStarted:false);
    for(int i=1;i<=total;i++){if(pause!=null)await pause();token.ThrowIfCancellationRequested();object sheet=null,used=null,rows=null,cols=null,cells=null,lastRow=null,lastCol=null,range=null;
     try{sheet=OfficeDispatch.Get(sheets,"Item",i);used=OfficeDispatch.Get(sheet,"UsedRange");cells=OfficeDispatch.Get(sheet,"Cells");
      // Find ignores formatting-only cells, includes formulas evaluating to an
      // empty string, and never changes the selection or workbook contents.
      lastRow=OfficeDispatch.Find(cells,"*",Type.Missing,-4123,2,1,2,false,Type.Missing,false);
      lastCol=OfficeDispatch.Find(cells,"*",Type.Missing,-4123,2,2,2,false,Type.Missing,false);
      var values=new JArray();var merges=new HashSet<string>(StringComparer.Ordinal);var row=new JObject{{"name",Text(sheet,"Name")},{"cells",values},{"merges",new JArray()}};
      if(lastRow!=null&&lastCol!=null){int firstRow=Int(used,"Row"),firstCol=Int(used,"Column"),endRow=Int(lastRow,"Row"),endCol=Int(lastCol,"Column");long count=(long)(endRow-firstRow+1)*(endCol-firstCol+1);
       if(count<0||count>cellBudget)throw new OfficeFault("markdown_source_limit",invocationStarted:false,inputRule:"max_200000_grid_cells_no_silent_truncation");cellBudget-=(int)count;
       range=OfficeDispatch.Get(sheet,"Range",Column(firstCol)+firstRow+":"+Column(endCol)+endRow);object data=OfficeDispatch.Get(range,"Value2"),formulas=OfficeDispatch.Get(range,"Formula");
       for(int r=firstRow;r<=endRow;r++)for(int c=firstCol;c<=endCol;c++){if(pause!=null&&(c-firstCol)%200==0)await pause();token.ThrowIfCancellationRequested();object value=At(data,r-firstRow,c-firstCol),formula=At(formulas,r-firstRow,c-firstCol);if(value==null&&String.IsNullOrEmpty(Convert.ToString(formula)))continue;
        object cell=null,area=null;try{string address=Column(c)+r;cell=OfficeDispatch.Get(sheet,"Range",address);bool hasFormula=Convert.ToBoolean(OfficeDispatch.Get(cell,"HasFormula"));string display=Text(cell,"Text");
         var item=new JObject{{"address",address},{"value",value==null?JValue.CreateNull():JToken.FromObject(value)},{"display",display},{"numberFormat",Text(cell,"NumberFormat")}};if(hasFormula)item["formula"]=Convert.ToString(formula,System.Globalization.CultureInfo.InvariantCulture);
         // A narrow column can display ####. Retain the raw value as readable
         // content rather than losing it to a visual overflow marker.
         if(display.Length>0&&display.All(x=>x=='#')){item["display"]=Convert.ToString(value,System.Globalization.CultureInfo.InvariantCulture);warnings.Add("좁은 열의 #### 표시는 원래 값으로 보존했습니다.");}
         values.Add(item);if(Convert.ToBoolean(OfficeDispatch.Get(cell,"MergeCells"))){area=OfficeDispatch.Get(cell,"MergeArea");merges.Add(Text(area,"Address"));}
        }finally{Release(area);Release(cell);}
       }
      }
      row["merges"]=new JArray(merges.OrderBy(x=>x,StringComparer.Ordinal));result.Add(row);
     }finally{Release(range);Release(lastCol);Release(lastRow);Release(cells);Release(cols);Release(rows);Release(used);Release(sheet);}
    }return result;
   }finally{Release(sheets);}
  }
  static async Task<JArray> ShapeBlocks(object shapes,CancellationToken token,JArray warnings,Func<Task> pause,int depth=0){if(depth>16)throw new OfficeFault("markdown_source_limit",invocationStarted:false);var blocks=new JArray();int count=Int(shapes,"Count");if(count>20000)throw new OfficeFault("markdown_source_limit",invocationStarted:false);
   for(int j=1;j<=count;j++){if(pause!=null&&j%100==1)await pause();token.ThrowIfCancellationRequested();object shape=null,frame=null,text=null,table=null,rows=null,cols=null,group=null;
    try{shape=OfficeDispatch.Get(shapes,"Item",j);int type=Int(shape,"Type");if(type==6){group=OfficeDispatch.Get(shape,"GroupItems");foreach(var b in await ShapeBlocks(group,token,warnings,pause,depth+1))blocks.Add(b);continue;}
     if(Convert.ToInt32(OfficeDispatch.Get(shape,"HasTable"))!=0){table=OfficeDispatch.Get(shape,"Table");rows=OfficeDispatch.Get(table,"Rows");cols=OfficeDispatch.Get(table,"Columns");int nr=Int(rows,"Count"),nc=Int(cols,"Count");if((long)nr*nc>200000)throw new OfficeFault("markdown_source_limit",invocationStarted:false);var grid=new JArray();
      for(int r=1;r<=nr;r++){var line=new JArray();for(int c=1;c<=nc;c++){if(pause!=null&&c%100==1)await pause();token.ThrowIfCancellationRequested();object cell=null,cs=null,cf=null,ct=null;try{cell=OfficeDispatch.Call(table,"Cell",r,c);cs=OfficeDispatch.Get(cell,"Shape");cf=OfficeDispatch.Get(cs,"TextFrame");ct=OfficeDispatch.Get(cf,"TextRange");line.Add(Text(ct,"Text"));}finally{Release(ct);Release(cf);Release(cs);Release(cell);}}grid.Add(line);}blocks.Add(new JObject{{"type","table"},{"rows",grid},{"header",false}});continue;
     }
     if(Convert.ToInt32(OfficeDispatch.Get(shape,"HasTextFrame"))!=0){frame=OfficeDispatch.Get(shape,"TextFrame");text=OfficeDispatch.Get(frame,"TextRange");string words=Text(text,"Text");if(!String.IsNullOrWhiteSpace(words))blocks.Add(new JObject{{"type","paragraph"},{"text",words}});}
     if(type==3)warnings.Add("차트의 시각 요소는 Markdown에 포함되지 않습니다. 슬라이드의 텍스트와 표를 보존했습니다.");
    }finally{Release(group);Release(cols);Release(rows);Release(table);Release(text);Release(frame);Release(shape);}
   }return blocks;
  }
  static async Task<JArray> PowerPoint(object doc,CancellationToken token,JArray warnings,Func<Task> pause){object slides=null;var result=new JArray();
   try{slides=OfficeDispatch.Get(doc,"Slides");int total=Int(slides,"Count");if(total>2000)throw new OfficeFault("markdown_source_limit",invocationStarted:false);
    for(int i=1;i<=total;i++){if(pause!=null)await pause();token.ThrowIfCancellationRequested();object slide=null,shapes=null,notes=null,ns=null;try{slide=OfficeDispatch.Get(slides,"Item",i);shapes=OfficeDispatch.Get(slide,"Shapes");var item=new JObject{{"slide",i},{"id",Int(slide,"SlideID")},{"blocks",await ShapeBlocks(shapes,token,warnings,pause)},{"notes",new JArray()}};
     notes=OfficeDispatch.Get(slide,"NotesPage");ns=OfficeDispatch.Get(notes,"Shapes");var values=new JArray();for(int n=1;n<=Int(ns,"Count");n++){object sh=null,placeholder=null,frame=null,range=null;try{sh=OfficeDispatch.Get(ns,"Item",n);if(Int(sh,"Type")!=14)continue;placeholder=OfficeDispatch.Get(sh,"PlaceholderFormat");if(Int(placeholder,"Type")!=2)continue;frame=OfficeDispatch.Get(sh,"TextFrame");range=OfficeDispatch.Get(frame,"TextRange");string text=Text(range,"Text");if(!String.IsNullOrWhiteSpace(text))values.Add(text);}finally{Release(range);Release(frame);Release(placeholder);Release(sh);}}item["notes"]=values;result.Add(item);
    }finally{Release(ns);Release(notes);Release(shapes);Release(slide);}}
    return result;
   }finally{Release(slides);}
  }
 }
}
