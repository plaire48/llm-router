using System;
using System.Runtime.InteropServices;
using OfficeX.Core;
using OfficeX.ExcelHost;
class Program {
 static void Equal(object a,object b){if(!object.Equals(a,b))throw new Exception("Expected "+a+", got "+b);}
 static void Main(){object dictionary=Activator.CreateInstance(Type.GetTypeFromProgID("Scripting.Dictionary",true));
  try{
   OfficeDispatch.Invoke(dictionary,"Add","call",new object[]{"name","누비"});Equal(1,OfficeDispatch.Get(dictionary,"Count"));Equal("누비",OfficeDispatch.Get(dictionary,"Item","name"));
   OfficeDispatch.Invoke(dictionary,"Item","set",new object[]{"name","변경"});Equal("변경",OfficeDispatch.Get(dictionary,"Item","name"));
   var data=new object[,]{{"항목",100},{"합계",200}};OfficeDispatch.Invoke(dictionary,"Add","call",new object[]{"matrix",data});var read=(Array)OfficeDispatch.Get(dictionary,"Item","matrix");Equal("합계",read.GetValue(read.GetLowerBound(0)+1,read.GetLowerBound(1)));Equal(200,read.GetValue(read.GetLowerBound(0)+1,read.GetLowerBound(1)+1));
   try{OfficeDispatch.Invoke(dictionary,"MissingMember","set",new object[]{42});throw new Exception("Expected lookup failure");}catch(OfficeFault e){Equal("office_member_not_found",e.Message);Equal(false,e.InvocationStarted);Equal("MissingMember",e.Member);}
   Equal(2,OfficeDispatch.Get(dictionary,"Count"));OfficeDispatch.Invoke(dictionary,"RemoveAll","call",new object[0]);Equal(0,OfficeDispatch.Get(dictionary,"Count"));
   Console.WriteLine("PASS Windows IDispatch method, argument order, property get/set, SAFEARRAY, missing-member no-write checks. Office runtime not tested.");
  }catch(OfficeFault e){Console.Error.WriteLine(Wire.Json(new{error=e.Message,member=e.Member,nativeCode=e.NativeCode,invocationStarted=e.InvocationStarted}));throw;}finally{Marshal.ReleaseComObject(dictionary);}
 }
}
