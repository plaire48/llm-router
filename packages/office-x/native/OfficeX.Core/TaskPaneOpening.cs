using System;
namespace OfficeX.Core {
 public static class TaskPaneOpening {
  // Never pass an empty title to the Office task-pane factory. Keep the extra
  // caption visually quiet; use the known working title if a host rejects it.
  public const string QuietCaption="\u200B";
  public const string CompatibleCaption="누비";
  public static T Create<T>(Func<string,T> addForWindow,Func<string,T> addForActiveWindow,Action<string> stage=null){
   stage?.Invoke("pane_add_quiet");
   try{return addForWindow(QuietCaption);}
   catch(ArgumentException){
    stage?.Invoke("pane_add_title_fallback");
    try{return addForWindow(CompatibleCaption);}
    catch(ArgumentException){stage?.Invoke("pane_add_active_window");return addForActiveWindow(CompatibleCaption);}
   }
  }
  public static void SetWidth(Action<int> setWidth,Action<string> stage=null){
   stage?.Invoke("pane_width");try{setWidth(420);}
   catch(ArgumentException){stage?.Invoke("pane_width_compact");try{setWidth(320);}catch(ArgumentException){stage?.Invoke("pane_width_default");}}
  }
 }
}
