$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
Add-Type -ReferencedAssemblies PresentationFramework, PresentationCore, WindowsBase, System.Xaml -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;

public static class NubiVisualPointer {
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h,int index);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h,int index,int value);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
  [DllImport("dwmapi.dll")] static extern int DwmFlush();
  static Window window; static IntPtr handle; static Ellipse ring; static DispatcherTimer timer;
  static double x,y,fromX,fromY,toX,toY; static bool known,moving; static string scope;
  static DateTime began,activity,pulseAt; static int moveId;
  static bool Motion { get { return SystemParameters.ClientAreaAnimation; } }
  static void Reply(int id,bool moved) {
    Console.Out.WriteLine("{\"id\":"+id+",\"available\":true,\"animated\":"+(moved?"true":"false")+",\"hwnd\":"+handle.ToInt64()+",\"x\":"+((int)Math.Round(x))+",\"y\":"+((int)Math.Round(y))+"}");Console.Out.Flush();
  }
  static void Position(){SetWindowPos(handle,new IntPtr(-1),(int)Math.Round(x)-10,(int)Math.Round(y)-10,0,0,0x0011);}
  static IntPtr Hook(IntPtr h,int msg,IntPtr w,IntPtr l,ref bool handled){if(msg==0x21){handled=true;return new IntPtr(3);}return IntPtr.Zero;}
  static void Command(string line){
    string[] p=line.Split(' ');int id;if(p.Length<2||!int.TryParse(p[0],out id))return;
    activity=DateTime.UtcNow;
    if(p[1]=="hide") { if(moving)Reply(moveId,false);moving=false;ring.Opacity=0;window.Hide();DwmFlush();Reply(id,false);return; }
    if(p[1]=="pulse") { pulseAt=activity;ring.Opacity=1;Reply(id,false);return; }
    int nx,ny;
    if(p[1]!="move"||p.Length!=5||!int.TryParse(p[2],out nx)||!int.TryParse(p[3],out ny)||Math.Abs((long)nx)>100000||Math.Abs((long)ny)>100000)return;
    bool animate=known&&scope==p[4]&&Motion&&(x!=nx||y!=ny);
    scope=p[4];fromX=x;fromY=y;toX=nx;toY=ny;moveId=id;began=activity;moving=animate;known=true;ring.Opacity=0;
    if(!animate){x=nx;y=ny;}
    Position();window.Show();Position();
    if(!animate)Reply(id,false);
  }
  public static void Run(){
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    window=new Window {Width=92,Height=54,WindowStyle=WindowStyle.None,ResizeMode=ResizeMode.NoResize,AllowsTransparency=true,Background=Brushes.Transparent,ShowActivated=false,ShowInTaskbar=false,Topmost=true,Focusable=false,Title="Nubi visual pointer"};
    var canvas=new Canvas {IsHitTestVisible=false};window.Content=canvas;
    var blue=(Brush)new BrushConverter().ConvertFromString("#171717");
    ring=new Ellipse {Width=16,Height=16,Stroke=blue,StrokeThickness=1.5,Opacity=0};Canvas.SetLeft(ring,2);Canvas.SetTop(ring,2);canvas.Children.Add(ring);
    var arrow=new System.Windows.Shapes.Path {Data=Geometry.Parse("M1,1 Q-1,0 0,4 L10,29 Q12,33 14,29 L17,20 L26,17 Q30,15 26,13 L4,1 Q2,0 1,1 Z"),Fill=blue,Stroke=Brushes.White,StrokeThickness=2.5,StrokeLineJoin=PenLineJoin.Round};Canvas.SetLeft(arrow,10);Canvas.SetTop(arrow,10);canvas.Children.Add(arrow);
    handle=new WindowInteropHelper(window).EnsureHandle();SetWindowLong(handle,-20,GetWindowLong(handle,-20)|0x08000000|0x20|0x80);
    HwndSource.FromHwnd(handle).AddHook(Hook);
    timer=new DispatcherTimer {Interval=TimeSpan.FromMilliseconds(16)};
    timer.Tick+=(s,e)=>{
      if(moving){double t=Math.Min(1,(DateTime.UtcNow-began).TotalMilliseconds/180),ease=1-Math.Pow(1-t,3);x=fromX+(toX-fromX)*ease;y=fromY+(toY-fromY)*ease;Position();if(t>=1){moving=false;Reply(moveId,true);}}
      if(ring.Opacity>0){double elapsed=(DateTime.UtcNow-pulseAt).TotalMilliseconds;ring.Opacity=elapsed>=140?0:Motion?1-elapsed/140:1;}
      if(window.IsVisible&&(DateTime.UtcNow-activity).TotalSeconds>25){window.Hide();known=false;}
    };timer.Start();
    var dispatcher=window.Dispatcher;
    Task.Run(()=>{try { string line;while((line=Console.In.ReadLine())!=null){string command=line;dispatcher.Invoke(new Action(()=>Command(command)));} } finally {dispatcher.BeginInvoke(new Action(()=>dispatcher.InvokeShutdown()));}});
    Dispatcher.Run();timer.Stop();window.Close();
  }
}
'@
[NubiVisualPointer]::Run()
