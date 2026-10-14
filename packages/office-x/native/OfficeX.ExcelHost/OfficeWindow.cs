using System;
using System.Runtime.InteropServices;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 // Verified against Office 2016 PIA metadata. Hidden window members can have
 // a stable DISPID while GetIDsOfNames("HWND") rejects their public name.
 // Bind only these window interfaces; never guess an ID on arbitrary objects.
 internal static class OfficeWindow {
  [ComImport,Guid("91493457-5A91-11CF-8700-00AA0060263B"),InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
  interface PowerPointWindow { [DispId(2020)] int HWND { get; } }
  [ComImport,Guid("00020962-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
  interface WordWindow { [DispId(39)] int Hwnd { get; } }
  public static int Handle(object window,string app){
   if(window==null)throw new OfficeFault("activate_source_window",invocationStarted:false);
   try{return app=="powerpoint"?((PowerPointWindow)window).HWND:app=="word"?((WordWindow)window).Hwnd:Convert.ToInt32(OfficeDispatch.Get(window,"HWND"));}
   catch(OfficeFault){throw;}catch(Exception e){throw new OfficeFault("office_window_binding_failed","HWND",e.HResult,false,e.GetType().Name);}
  }
 }
}
