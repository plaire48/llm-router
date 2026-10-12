using System;
using System.Text.RegularExpressions;

namespace OfficeX.Core
{
    public sealed class Region
    {
        public int Row { get; private set; }
        public int Column { get; private set; }
        public int EndRow { get; private set; }
        public int EndColumn { get; private set; }
        public int Rows => EndRow - Row + 1;
        public int Columns => EndColumn - Column + 1;
        public string Address => CellAddress(Row, Column) + (Rows == 1 && Columns == 1 ? "" : ":" + CellAddress(EndRow, EndColumn));
        private static readonly Regex Pattern = new Regex(@"^([A-Z]{1,3})([1-9][0-9]{0,6})(?::([A-Z]{1,3})([1-9][0-9]{0,6}))?$", RegexOptions.CultureInvariant);
        public static Region Parse(string address) {
            var m = Pattern.Match(address ?? "");
            if (!m.Success) throw new OfficeFault("address_invalid");
            int ColumnNumber(string s) { int n=0; foreach(var c in s) n=n*26+c-'A'+1; return n; }
            var r = new Region { Row=int.Parse(m.Groups[2].Value), Column=ColumnNumber(m.Groups[1].Value) };
            r.EndRow=m.Groups[4].Success ? int.Parse(m.Groups[4].Value) : r.Row;
            r.EndColumn=m.Groups[3].Success ? ColumnNumber(m.Groups[3].Value) : r.Column;
            if(r.EndRow<r.Row || r.EndColumn<r.Column || r.EndRow>1048576 || r.EndColumn>16384) throw new OfficeFault("address_invalid");
            return r;
        }
        public static string Surrounding(string selection,string currentRegion) {
            var anchor=Parse(selection);var current=Parse(currentRegion);
            if(current.Rows<=101&&current.Columns<=20&&(current.Rows>1||current.Columns>1))return current.Address;
            // A blank or isolated cell still exposes a bounded neighborhood.
            int top=Math.Max(1,anchor.Row-10),left=Math.Max(1,anchor.Column-5);
            int bottom=Math.Min(1048576,top+(current.Rows>1?100:20)),right=Math.Min(16384,left+19);
            return CellAddress(top,left)+":"+CellAddress(bottom,right);
        }
        public bool Contains(Region other) => other.Row>=Row && other.Column>=Column && other.EndRow<=EndRow && other.EndColumn<=EndColumn;
        public static string CellAddress(int row,int column) {
            var s=""; while(column>0) { column--; s=(char)('A'+column%26)+s; column/=26; } return s+row;
        }
    }
}
