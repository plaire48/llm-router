using System;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 // Window objects come only from the host's ActiveWindow/DocumentWindows.
 // Use base IDispatch, not an Office-specific interface projection. Hidden HWND
 // properties have stable IDs in the Office 2016-compatible PIA metadata.
 public static class OfficeWindow {
  public static object GetActiveWindow(object application)=>OfficeDispatch.Get(application,"ActiveWindow");
  public static int Handle(object window,string app){
   if(window==null)throw new OfficeFault("activate_source_window",invocationStarted:false);
   if(app!="excel"&&app!="word"&&app!="powerpoint")throw new OfficeFault("office_app_invalid",invocationStarted:false);
   try{
    object value=app=="excel"?OfficeDispatch.Get(window,"HWND"):OfficeDispatch.WindowHandle(window,app=="powerpoint"?2020:39);
    int handle=Convert.ToInt32(value);
    if(handle==0)throw new OfficeFault("activate_source_window",invocationStarted:false);
    return handle;
   }catch(OfficeFault){throw;}catch(Exception e){throw new OfficeFault("office_window_binding_failed","HWND",e.HResult,false,e.GetType().Name);}
  }
 }
}
