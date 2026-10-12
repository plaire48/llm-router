using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using OfficeX.Core;
using Excel = Microsoft.Office.Interop.Excel;
using Region = OfficeX.Core.Region;

namespace OfficeX.ExcelHost
{
    // Adapted from Nubi.Office.Host.ExcelPort's live COM identity binding.
    // All calls, including construction and disposal, stay on the Office UI thread.
    public sealed class ExcelPort : IExcelPort, IExcelContextPort, IDisposable
    {
        private readonly Excel.Application app;
        private readonly int uiThread = Thread.CurrentThread.ManagedThreadId;
        private readonly int windowHandle;
        private readonly Dictionary<string, (long book, long sheet)> identities = new Dictionary<string, (long, long)>();
        public ExcelPort(Excel.Application app, int windowHandle) {
            this.app=app; this.windowHandle=windowHandle;
            app.WorkbookBeforeClose+=Closing; app.SheetBeforeDelete+=Deleting;
        }
        private void AssertThread() { if(Thread.CurrentThread.ManagedThreadId!=uiThread) throw new OfficeFault("office_thread_required"); }
        private static long Identity(object value) {
            var ptr=Marshal.GetIUnknownForObject(value); try {return ptr.ToInt64();} finally {Marshal.Release(ptr);}
        }
        private void Closing(Excel.Workbook book, ref bool cancel) {
            var id=Identity(book); foreach(var key in identities.Where(p=>p.Value.book==id).Select(p=>p.Key).ToArray()) identities.Remove(key);
        }
        private void Deleting(object sheet) {
            var id=Identity(sheet); foreach(var key in identities.Where(p=>p.Value.sheet==id).Select(p=>p.Key).ToArray()) identities.Remove(key);
        }
        private Excel.Worksheet Resolve(Snapshot binding) {
            AssertThread();
            if(!identities.TryGetValue(binding.DocumentId+":"+binding.WorksheetId,out var ids)) throw new OfficeFault("document_closed");
            foreach(Excel.Workbook book in app.Workbooks)
                if(Identity(book)==ids.book)
                    foreach(Excel.Worksheet sheet in book.Worksheets) if(Identity(sheet)==ids.sheet) return sheet;
            throw new OfficeFault("document_closed");
        }
        public Snapshot CaptureSelection() {
            AssertThread();
            if(app.ActiveWindow==null || app.ActiveWindow.Hwnd!=windowHandle) throw new OfficeFault("activate_source_window");
            var range=app.Selection as Excel.Range;
            if(range==null) throw new OfficeFault("select_cells");
            if(range.Areas.Count!=1) throw new OfficeFault("single_range_required");
            var sheet=(Excel.Worksheet)range.Worksheet; var book=(Excel.Workbook)sheet.Parent;
            var binding=new Snapshot {DocumentId=Guid.NewGuid().ToString("N"),WorksheetId=Guid.NewGuid().ToString("N"),
                Address=range.get_Address(false,false,Excel.XlReferenceStyle.xlA1)};
            // A session gets fresh opaque identities; no paths are accepted from the worker.
            identities.Clear(); identities.Add(binding.DocumentId+":"+binding.WorksheetId,(Identity(book),Identity(sheet)));
            return Read(binding,binding.Address);
        }
        public ExcelReadContext GetReadContext(Snapshot binding) {
            AssertThread();if(!app.Ready)throw new OfficeFault("excel_busy");
            var sheet=Resolve(binding);
            Excel.Range selected=null,current=null,used=null;
            try {
                selected=sheet.get_Range(binding.Address);current=selected.CurrentRegion;used=sheet.UsedRange;
                var currentAddress=current.get_Address(false,false,Excel.XlReferenceStyle.xlA1);
                var readAddress=Region.Surrounding(binding.Address,currentAddress);
                return new ExcelReadContext{Selection=binding.Address,CurrentRegion=currentAddress,UsedRange=used.get_Address(false,false,Excel.XlReferenceStyle.xlA1),SurroundingRange=readAddress,Truncated=!Region.Parse(readAddress).Contains(Region.Parse(currentAddress))};
            } finally {if(used!=null)Marshal.ReleaseComObject(used);if(current!=null)Marshal.ReleaseComObject(current);if(selected!=null)Marshal.ReleaseComObject(selected);}
        }
        public Snapshot Read(Snapshot binding,string address) {
            AssertThread();
            if(!app.Ready) throw new OfficeFault("excel_busy");
            var region=Region.Parse(address);
            if(region.Rows>101||region.Columns>20||(long)region.Rows*region.Columns>2020) throw new OfficeFault("range_limit");
            var sheet=Resolve(binding); var book=(Excel.Workbook)sheet.Parent;
            var result=new Snapshot {DocumentId=binding.DocumentId,WorksheetId=binding.WorksheetId,Workbook=book.Name,
                Worksheet=sheet.Name,Address=region.Address,ReadOnly=book.ReadOnly,Protected=sheet.ProtectContents,
                CalculationDone=app.CalculationState==Excel.XlCalculationState.xlDone};
            var range=sheet.get_Range(region.Address);
            var values=range.Value2; var formulas=range.Formula;
            object At(object data,int r,int c) => data is Array array ? array.GetValue(r+1,c+1) : data;
            // Table calculated columns can propagate outside the reviewed selection.
            var tables=new List<Region>();
            foreach(Excel.ListObject table in sheet.ListObjects) tables.Add(Region.Parse(table.Range.get_Address(false,false,Excel.XlReferenceStyle.xlA1)));
            for(int row=0;row<region.Rows;row++) for(int col=0;col<region.Columns;col++) {
                var cell=(Excel.Range)range.Cells[row+1,col+1]; var value=At(values,row,col);
                var error=value is ErrorWrapper || (value is int n && n < -2146800000);
                var cellAddress=Region.CellAddress(region.Row+row,region.Column+col);
                result.Cells.Add(new Cell {Address=cellAddress,Value=error ? "#EXCEL_ERROR" : value,Error=error,
                    Formula=Convert.ToBoolean(cell.HasFormula) ? Convert.ToString(At(formulas,row,col)) : null,
                    Merged=Convert.ToBoolean(cell.MergeCells),ArrayFormula=Convert.ToBoolean(cell.HasArray),
                    Hidden=Convert.ToBoolean(cell.EntireRow.Hidden)||Convert.ToBoolean(cell.EntireColumn.Hidden),
                    Table=tables.Any(t=>t.Contains(Region.Parse(cellAddress))),Locked=Convert.ToBoolean(cell.Locked)});
            }
            return result;
        }
        public void WriteFormula(Snapshot binding,string address,string formula) {
            AssertThread(); var sheet=Resolve(binding); var book=(Excel.Workbook)sheet.Parent;
            var region=Region.Parse(address);
            if(!Region.Parse(binding.Address).Contains(region)||region.Rows!=1||region.Columns!=1) throw new OfficeFault("out_of_scope");
            if(book.ReadOnly||sheet.ProtectContents||!app.Ready) throw new OfficeFault("workbook_not_writable");
            var cell=sheet.get_Range(address);
            if(Convert.ToBoolean(cell.MergeCells)||Convert.ToBoolean(cell.HasArray)||cell.Value2!=null||Convert.ToBoolean(cell.HasFormula)) throw new OfficeFault("target_changed");
            var events=app.EnableEvents;
            try { app.EnableEvents=false; cell.Formula=formula; }
            finally { app.EnableEvents=events; }
        }
        public void Calculate(Snapshot binding) {
            AssertThread(); if(!app.Ready) throw new OfficeFault("excel_busy");
            var range=Resolve(binding).get_Range(binding.Address);var events=app.EnableEvents;
            try {app.EnableEvents=false;range.Calculate();} finally {app.EnableEvents=events;}
        }
        public void Dispose() { AssertThread(); app.WorkbookBeforeClose-=Closing; app.SheetBeforeDelete-=Deleting; identities.Clear(); }
    }
}
