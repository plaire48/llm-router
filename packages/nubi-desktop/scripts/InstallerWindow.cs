using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
public class InstallerControl { public long Handle; public int Id; public string Text; public string Class; public bool Enabled; }
public static class InstallerWindow {
  delegate bool EnumProc(IntPtr hwnd, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int max);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder text,int max);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd,int message,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd,int message,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd,IntPtr dc,uint flags);
  [StructLayout(LayoutKind.Sequential)] struct Rect {public int Left,Top,Right,Bottom;}
  public static InstallerControl[] Controls(IntPtr parent) {
    var list=new List<InstallerControl>();
    EnumChildWindows(parent,(h,p)=>{if(IsWindowVisible(h)){var text=new StringBuilder(2048);var cls=new StringBuilder(100);GetWindowText(h,text,text.Capacity);GetClassName(h,cls,cls.Capacity);list.Add(new InstallerControl{Handle=h.ToInt64(),Id=GetDlgCtrlID(h),Text=text.ToString(),Class=cls.ToString(),Enabled=IsWindowEnabled(h)});}return true;},IntPtr.Zero);
    return list.ToArray();
  }
  public static void Click(long handle){PostMessage(new IntPtr(handle),0xF5,IntPtr.Zero,IntPtr.Zero);}
  public static bool Checked(long handle){return SendMessage(new IntPtr(handle),0xF0,IntPtr.Zero,IntPtr.Zero).ToInt32()==1;}
  public static void Capture(IntPtr hwnd,string path){Rect r;if(!GetWindowRect(hwnd,out r))throw new Exception("Installer bounds unavailable");using(var image=new Bitmap(r.Right-r.Left,r.Bottom-r.Top)){using(var g=Graphics.FromImage(image)){var dc=g.GetHdc();try{if(!PrintWindow(hwnd,dc,0))throw new Exception("Installer capture failed");}finally{g.ReleaseHdc(dc);}}image.Save(path,ImageFormat.Png);}}
}
