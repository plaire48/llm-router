using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using OfficeX.Core;
using TYPEATTR=System.Runtime.InteropServices.ComTypes.TYPEATTR;
using FUNCDESC=System.Runtime.InteropServices.ComTypes.FUNCDESC;
using INVOKEKIND=System.Runtime.InteropServices.ComTypes.INVOKEKIND;
namespace OfficeX.ExcelHost {
 internal static class OfficeMembers {
  [ComImport,Guid("00020400-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface DispatchInfo {[PreserveSig]int GetTypeInfoCount(out uint count);[PreserveSig]int GetTypeInfo(uint index,uint lcid,out ITypeInfo info);}
  public static object Read(object target,string query,int count){var dispatch=target as DispatchInfo;if(dispatch==null)throw new OfficeFault("office_member_metadata_unavailable");ITypeInfo info=null;IntPtr attr=IntPtr.Zero;
   try{int hr=dispatch.GetTypeInfo(0,1033,out info);if(hr<0)hr=dispatch.GetTypeInfo(0,0,out info);if(hr<0||info==null)throw new OfficeFault("office_member_metadata_unavailable",nativeCode:hr,invocationStarted:false);info.GetTypeAttr(out attr);var type=(TYPEATTR)Marshal.PtrToStructure(attr,typeof(TYPEATTR));var items=new List<object>();int limit=Math.Max(1,Math.Min(200,count));
    for(int i=0;i<type.cFuncs&&items.Count<limit;i++){IntPtr ptr=IntPtr.Zero;try{info.GetFuncDesc(i,out ptr);var f=(FUNCDESC)Marshal.PtrToStructure(ptr,typeof(FUNCDESC));var names=new string[32];info.GetNames(f.memid,names,names.Length,out var found);string name=names[0];if(!OfficeCallPolicy.Exposed(name)||!String.IsNullOrEmpty(query)&&name.IndexOf(query,StringComparison.OrdinalIgnoreCase)<0)continue;var parameters=new List<string>();for(int j=1;j<found;j++)parameters.Add(names[j]);items.Add(new{name,action=f.invkind==INVOKEKIND.INVOKE_PROPERTYGET?"get":f.invkind==INVOKEKIND.INVOKE_PROPERTYPUT||f.invkind==INVOKEKIND.INVOKE_PROPERTYPUTREF?"set":"call",parameterCount=f.cParams,optionalParameters=f.cParamsOpt,parameters,readOnlyCall=OfficeCallPolicy.ReadCall(name)});}finally{if(ptr!=IntPtr.Zero)info.ReleaseFuncDesc(ptr);}}
    return new{members=items,limit,retrievedFrom="live_office_type_info",instruction="Root document is the open Workbook/Document/Presentation. Read child objects using get + id before accessing their members. Search one specific member name to check its signature."};
   }finally{if(attr!=IntPtr.Zero)info.ReleaseTypeAttr(attr);if(info!=null&&Marshal.IsComObject(info))Marshal.ReleaseComObject(info);}
  }
 }
}
