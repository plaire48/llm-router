using System;
using System.Globalization;
using System.Threading;
namespace OfficeX.ExcelHost {
 // Office's canonical Automation API uses English member/formula names. LCID 127
 // (InvariantCulture) can make localized Excel look for a nonexistent type library.
 internal sealed class OfficeCulture:IDisposable {
  readonly CultureInfo before=Thread.CurrentThread.CurrentCulture;
  public static readonly CultureInfo Automation=CultureInfo.GetCultureInfo("en-US");
  public OfficeCulture(){Thread.CurrentThread.CurrentCulture=Automation;}
  public void Dispose(){Thread.CurrentThread.CurrentCulture=before;}
 }
}
