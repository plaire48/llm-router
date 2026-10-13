using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using DISPPARAMS=System.Runtime.InteropServices.ComTypes.DISPPARAMS;
using EXCEPINFO=System.Runtime.InteropServices.ComTypes.EXCEPINFO;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 // Invoke the object's IDispatch directly. Do not reflect over System.__ComObject
 // or retry a mutation after an uncertain result. No type-library loading needed.
 internal static class OfficeDispatch {
  [ComImport,Guid("00020400-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface Dispatch {
   [PreserveSig]int GetTypeInfoCount(out uint count);
   [PreserveSig]int GetTypeInfo(uint index,uint lcid,out ITypeInfo info);
   [PreserveSig]int GetIDsOfNames(ref Guid iid,[MarshalAs(UnmanagedType.LPArray,ArraySubType=UnmanagedType.LPWStr)]string[] names,uint count,uint lcid,[Out] int[] ids);
   [PreserveSig]int Invoke(int id,ref Guid iid,uint lcid,ushort flags,ref DISPPARAMS args,[MarshalAs(UnmanagedType.Struct)]out object result,ref EXCEPINFO exception,out uint argumentError);
  }
  [DllImport("oleaut32.dll")]static extern int VariantClear(IntPtr variant);
  public static object Get(object target,string member,params object[] args)=>Invoke(target,member,"get",args);
  public static object Invoke(object target,string member,string action,object[] args){
   var dispatch=target as Dispatch;if(dispatch==null)throw new OfficeFault("office_dispatch_unavailable",member,invocationStarted:false);
   var iid=Guid.Empty;var ids=new int[1];int hr=dispatch.GetIDsOfNames(ref iid,new[]{member},1,1033,ids);
   if(hr<0)throw new OfficeFault(OfficeCallPolicy.ErrorCode(hr),member,hr,false);
   int size=IntPtr.Size==8?24:16,count=args?.Length??0,initialized=0;IntPtr variants=IntPtr.Zero,named=IntPtr.Zero;
   try{
    if(count>0){variants=Marshal.AllocCoTaskMem(size*count);for(int i=0;i<size*count;i++)Marshal.WriteByte(variants,i,0);for(int i=0;i<count;i++){Marshal.GetNativeVariantForObject(args[count-1-i],IntPtr.Add(variants,i*size));initialized++;}}
    bool setting=action=="set";if(setting){named=Marshal.AllocCoTaskMem(4);Marshal.WriteInt32(named,-3);}
    var parameters=new DISPPARAMS{rgvarg=variants,cArgs=count,rgdispidNamedArgs=named,cNamedArgs=setting?1:0};var exception=new EXCEPINFO();object result;uint argumentError;
    ushort flags=(ushort)(setting?4:action=="call"?1:OfficeCallPolicy.ReadCall(member)?3:2);
    hr=dispatch.Invoke(ids[0],ref iid,1033,flags,ref parameters,out result,ref exception,out argumentError);
    if(hr<0){int code=exception.scode<0?exception.scode:hr;throw new OfficeFault(OfficeCallPolicy.ErrorCode(code),member,code,OfficeCallPolicy.BeforeInvocation(code)?false:(bool?)null);}
    return result;
   }finally{for(int i=0;i<initialized;i++)VariantClear(IntPtr.Add(variants,i*size));if(variants!=IntPtr.Zero)Marshal.FreeCoTaskMem(variants);if(named!=IntPtr.Zero)Marshal.FreeCoTaskMem(named);}
  }
 }
}
