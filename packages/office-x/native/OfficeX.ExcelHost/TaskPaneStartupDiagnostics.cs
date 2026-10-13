using System;
using OfficeX.Core;
namespace OfficeX.ExcelHost {
 public static class TaskPaneStartupDiagnostics {
  public static string Describe(Exception error,string app,string stage){
   var record=Wire.Object(OfficeDiagnostics.Record(error,app,stage));
   string phase=stage=="window_lookup"||stage=="follow_window_lookup"?"문서 창 확인":stage=="control_create"?"채팅 화면 준비":stage!=null&&stage.StartsWith("pane_add_")?"Office 작업창 생성":stage!=null&&stage.StartsWith("pane_width")?"작업창 크기 설정":stage=="pane_show"?"작업창 표시":"작업창 준비";
   return "작업창을 열지 못했습니다.\r\n"+phase+" / "+(string)record["exception"]+"\r\n"+((string)record["parameter"]==null?"":"인자: "+(string)record["parameter"]+"\r\n")+"코드: "+(string)record["nativeCode"]+"\r\n확인 번호: "+(string)record["id"];
  }
 }
}
