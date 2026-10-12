param([Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'InstallerWindow.cs') -ReferencedAssemblies System.Drawing.Common,System.Drawing.Primitives,System.Collections
$clock=[Diagnostics.Stopwatch]::StartNew()
$p=Start-Process $Installer -ArgumentList "/D=$Target" -PassThru
$observations=[Collections.Generic.List[object]]::new()
$captured=$false
$last=''
try {
  while (!$p.HasExited -and $clock.Elapsed.TotalMinutes -lt 12) {
    $p.Refresh()
    $window=$p.MainWindowHandle
    if ($window -ne [IntPtr]::Zero) {
      $controls=@([InstallerWindow]::Controls($window))
      $text=($controls | Where-Object {$_.Text} | ForEach-Object {$_.Text}) -join ' | '
      if ($text -ne $last) {$observations.Add(@{seconds=[Math]::Round($clock.Elapsed.TotalSeconds,2);text=$text});$last=$text}
      if (!$captured -and $text -match '파일 풀기.*\d+%') {
        [InstallerWindow]::Capture($window,(Join-Path (Get-Location) 'verification/windows-installer-progress.png'));$captured=$true
      }
      foreach ($control in $controls | Where-Object {$_.Class -eq 'Button' -and $_.Text -match '누비 Workspace 실행'}) {
        if ([InstallerWindow]::Checked($control.Handle)) {[InstallerWindow]::Click($control.Handle);Start-Sleep -Milliseconds 100}
      }
      $next=$controls | Where-Object {$_.Class -eq 'Button' -and $_.Id -eq 1 -and $_.Enabled} | Select-Object -First 1
      if ($next) {
        if ($text -match '설치 완료') {[InstallerWindow]::Capture($window,(Join-Path (Get-Location) 'verification/windows-installer-finish.png'))}
        [InstallerWindow]::Click($next.Handle)
        Start-Sleep -Milliseconds 300
      }
    }
    Start-Sleep -Milliseconds 100
  }
  if (!$p.HasExited) {throw 'Visible installer timed out'}
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) {throw "Visible installer exit: $($p.ExitCode)"}
  if (!$captured) {throw 'Native extraction percentage was not observed'}
  if (!(($observations.text -join ' ') -match '경과 \d+초')) {throw 'Native elapsed time was not observed'}
  if (!(Test-Path (Join-Path $Target 'Nubi Workspace.exe'))) {throw 'Visible installer used unexpected destination'}
  @{elapsedSeconds=[Math]::Round($clock.Elapsed.TotalSeconds,2);nativeVisibleProgress=$true;observations=$observations.ToArray()} | ConvertTo-Json -Depth 5 | Set-Content verification/windows-installer-experience.json
} finally {
  $observations.ToArray() | ConvertTo-Json -Depth 5 | Set-Content verification/windows-installer-ui-observations.json
}
