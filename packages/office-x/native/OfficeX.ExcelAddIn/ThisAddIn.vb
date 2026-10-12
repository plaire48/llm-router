' Adapted for Office X from Nubi Office's VSTO entry point.
' Original VSTO host: it235/office-ai-agent, Apache-2.0. See THIRD-PARTY-NOTICES.md.
Imports System.IO
Imports System.Collections.Generic
Imports System.Runtime.InteropServices
Imports Office = Microsoft.Office.Core

Partial Public Class ThisAddIn
    Private ReadOnly panes As New Dictionary(Of Integer, Microsoft.Office.Tools.CustomTaskPane)()

    Protected Overrides Function CreateRibbonExtensibilityObject() As Office.IRibbonExtensibility
        Return New OfficeXRibbon()
    End Function

    Public Sub ShowOfficeX()
        Try
            Dim window = Application.ActiveWindow
            If window Is Nothing Then Return
            Dim pane As Microsoft.Office.Tools.CustomTaskPane = Nothing
            If Not panes.TryGetValue(window.Hwnd, pane) Then
                Dim control = CreateControl(window.Hwnd)
                Try
                    pane = CustomTaskPanes.Add(control, "누비 Agent")
                    pane.Width = 420
                    panes.Add(window.Hwnd, pane)
                Catch
                    control.Dispose()
                    If pane IsNot Nothing Then CustomTaskPanes.Remove(pane)
                    Throw
                End Try
            End If
            pane.Visible = True
        Catch ex As Exception
            System.Windows.Forms.MessageBox.Show("Office X 작업창을 열지 못했습니다. 빌드 결과와 Windows 실행 안내를 확인해 주세요." & vbCrLf & ex.GetType().Name, "Office X")
        End Try
    End Sub

    <System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)>
    Private Function CreateControl(windowHandle As Integer) As System.Windows.Forms.UserControl
        Dim codeBase = New Uri(GetType(ThisAddIn).Assembly.CodeBase)
        Dim directory = Path.GetDirectoryName(If(codeBase.IsFile, codeBase.LocalPath, GetType(ThisAddIn).Assembly.Location))
        Return New OfficeX.ExcelHost.OfficePane(Application, Path.Combine(directory, "OfficeX"), windowHandle)
    End Function

    Private Sub Starting() Handles Me.Startup
        AddHandler Application.WorkbookBeforeClose, AddressOf ClosingWorkbook
    End Sub

    Private Sub ClosingWorkbook(book As Microsoft.Office.Interop.Excel.Workbook, ByRef cancel As Boolean)
        ' Conservatively dispose every pane/session even if closing is later cancelled.
        ClosePanes(True)
    End Sub

    Private Sub ClosePanes(removeFromCollection As Boolean)
        For Each pane In panes.Values
            Try
                pane.Control.Dispose()
                If removeFromCollection Then CustomTaskPanes.Remove(pane)
            Catch ex As ObjectDisposedException
                ' The VSTO generated shutdown may already have disposed the collection.
            End Try
        Next
        panes.Clear()
    End Sub

    Private Sub Stopping() Handles Me.Shutdown
        RemoveHandler Application.WorkbookBeforeClose, AddressOf ClosingWorkbook
        ClosePanes(False)
    End Sub
End Class

<ComVisible(True)>
Public Class OfficeXRibbon
    Implements Office.IRibbonExtensibility
    Public Function GetCustomUI(ribbonId As String) As String Implements Office.IRibbonExtensibility.GetCustomUI
        Return "<customUI xmlns=""http://schemas.microsoft.com/office/2009/07/customui"" loadImage=""LoadNubiImage""><ribbon><tabs><tab id=""officeXTab"" label=""누비 Agent""><group id=""officeXGroup"" label=""문서 작업""><button id=""officeXOpen"" label=""누비 Agent 열기"" size=""large"" image=""nubi"" onAction=""OpenPane"" screentip=""선택한 표 읽기와 수식 입력""/></group></tab></tabs></ribbon></customUI>"
    End Function
    Public Function LoadNubiImage(imageId As String) As System.Drawing.Bitmap
        Dim codeBase = New Uri(GetType(ThisAddIn).Assembly.CodeBase)
        Dim directory = Path.GetDirectoryName(If(codeBase.IsFile, codeBase.LocalPath, GetType(ThisAddIn).Assembly.Location))
        Using source As New System.Drawing.Bitmap(Path.Combine(directory, "OfficeX", "ui", "icons", "agent-128.png"))
            Return New System.Drawing.Bitmap(source)
        End Using
    End Function

    Public Sub OpenPane(control As Office.IRibbonControl)
        Globals.ThisAddIn.ShowOfficeX()
    End Sub
End Class
