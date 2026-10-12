param([Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'InstallerWindow.cs')
function Save-InstallerCapture([IntPtr]$Window,[string]$Path) {
  [InstallerWindow]::Foreground($Window)
  Start-Sleep -Milliseconds 150
  $bounds=[InstallerWindow]::Bounds($Window)
  $image=[Drawing.Bitmap]::new($bounds[2],$bounds[3])
  try {
    $graphics=[Drawing.Graphics]::FromImage($image)
    try {$graphics.CopyFromScreen($bounds[0],$bounds[1],0,0,$image.Size)} finally {$graphics.Dispose()}
    $image.Save($Path,[Drawing.Imaging.ImageFormat]::Png)
  } finally {$image.Dispose()}
}
$clock=[Diagnostics.Stopwatch]::StartNew()
$p=Start-Process $Installer -ArgumentList "/D=$Target" -PassThru
$observations=[Collections.Generic.List[object]]::new()
$captured=$false
$etaCaptured=$false
$last=''
$finishAt=$null
$finishCaptured=$false
$noticeCaptured=$false
$detailsObserved=$false
$appWindowAt=$null
$launched=@()
$appPath=Join-Path $Target 'Nubi Workspace.exe'
try {
  while (!$p.HasExited -and $clock.Elapsed.TotalMinutes -lt 12) {
    $p.Refresh()
    $window=$p.MainWindowHandle
    if ($window -ne [IntPtr]::Zero) {
      $controls=@([InstallerWindow]::Controls($window))
      $text=($controls | Where-Object {$_.Text} | ForEach-Object {$_.Text}) -join ' | '
      if ($text -ne $last) {$observations.Add(@{seconds=[Math]::Round($clock.Elapsed.TotalSeconds,2);text=$text});$last=$text}
      if (!$noticeCaptured -and $text -match '설치 전 이용 안내') {
        foreach($required in @('AI 계정 연결','연결한 AI로 전달','사내 Github SSO','회사망 또는 VPN','첨부파일 내용 읽기')) {
          if ($text -notmatch [regex]::Escape($required)) {throw "Install notice missing: $required"}
        }
        Save-InstallerCapture $window (Join-Path (Get-Location) 'verification/windows-installer-notice.png')
        $noticeCaptured=$true
      }
      if ($text -match '파일 풀기.*\d+%') {
        if ($controls | Where-Object {$_.Class -eq 'Button' -and $_.Id -eq 1027}) {throw 'Details toggle must not be shown'}
        if (!($controls | Where-Object {$_.Class -eq 'SysListView32'})) {throw 'Installation details must be visible by default'}
        $detailsObserved=$true
      }
      if (!$captured -and $text -match '파일 풀기.*\d+%') {
        Save-InstallerCapture $window (Join-Path (Get-Location) 'verification/windows-installer-progress.png');$captured=$true
      }
      if (!$etaCaptured -and $text -match '파일 풀기 약 (?:[1-9]\d*분(?: [1-9]\d*초)?|[1-9]\d*초) 남음') {
        Save-InstallerCapture $window (Join-Path (Get-Location) 'verification/windows-installer-progress.png');$etaCaptured=$true
      }
      $next=$controls | Where-Object {$_.Class -eq 'Button' -and $_.Id -eq 1 -and $_.Enabled} | Select-Object -First 1
      if ($next -and $null -eq $finishAt) {
        if ($text -match '누비 Workspace 설치 완료') {
          # Click Finish once, with Launch checked. Repeated queued BM_CLICKs
          # could close the window before the next screenshot read its bounds.
          $launch=$controls | Where-Object {$_.Class -eq 'Button' -and $_.Text -match '누비 Workspace 실행'} | Select-Object -First 1
          if (!$launch -or ![InstallerWindow]::Checked($launch.Handle)) {throw 'Finish must exercise Launch checked'}
          Save-InstallerCapture $window (Join-Path (Get-Location) 'verification/windows-installer-finish.png')
          $finishCaptured=$true
          $finishAt=$clock.Elapsed.TotalSeconds
        }
        [InstallerWindow]::Click($next.Handle)
        Start-Sleep -Milliseconds 300
      }
    }
    Start-Sleep -Milliseconds 100
  }
  if (!$p.HasExited) {throw 'Visible installer timed out'}
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) {throw "Visible installer exit: $($p.ExitCode)"}
  $finishExitSeconds=if($null -ne $finishAt){$clock.Elapsed.TotalSeconds-$finishAt}else{$null}
  if (!$finishCaptured -or $null -eq $finishExitSeconds -or $finishExitSeconds -gt 15) {throw 'Finish did not exit promptly after launch request'}
  while ($clock.Elapsed.TotalSeconds-$finishAt -lt 45) {
    $launched=@(Get-Process -Name 'Nubi Workspace' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $appPath})
    if ($launched | Where-Object {$_.MainWindowHandle -ne [IntPtr]::Zero -and $_.Responding}) {$appWindowAt=$clock.Elapsed.TotalSeconds;break}
    Start-Sleep -Milliseconds 200
  }
  if ($null -eq $appWindowAt) {throw 'Finish did not open a responding installed app window'}
  if (!$captured) {throw 'Native extraction percentage was not observed'}
  if (!$noticeCaptured) {throw 'Pre-install usage notice was not observed'}
  if (!$detailsObserved) {throw 'Default installation details were not observed'}
  if (!$etaCaptured) {throw 'Measured extraction remaining time was not observed'}
  if (!(($observations.text -join ' ') -match '진행 (?:[1-9]\d*분(?: [1-9]\d*초)?|\d+초)')) {throw 'Native elapsed time was not observed'}
  if (($observations.text -join ' ') -match '(?<!\d)0분') {throw 'Zero minutes must be omitted from elapsed and remaining time'}
  if (($observations.text -join ' ') -match '남은 시간 계산 중') {throw 'Unknown remaining time must not stay as a calculating placeholder'}
  if (!(Test-Path (Join-Path $Target 'Nubi Workspace.exe'))) {throw 'Visible installer used unexpected destination'}
  $removal=@($observations | Where-Object {$_.text -match '이전 설치 확인'})
  if($removal.Count){
    $afterRemoval=$observations | Where-Object {$_.seconds -gt $removal[-1].seconds -and $_.text -notmatch '이전 설치 확인'} | Select-Object -First 1
    if($afterRemoval -and $afterRemoval.seconds-$removal[0].seconds -ge 4 -and $removal.Count -lt 3){throw 'Old-uninstaller elapsed display did not advance'}
    for($i=1;$i -lt $removal.Count;$i++){if($removal[$i].seconds-$removal[$i-1].seconds -gt 5){throw 'Old-uninstaller elapsed clock stalled'}}
  }
  @{elapsedSeconds=[Math]::Round($clock.Elapsed.TotalSeconds,2);finishExitSeconds=$finishExitSeconds;finishToAppWindowSeconds=$appWindowAt-$finishAt;launchChecked=$true;nativeVisibleProgress=$true;usageNotice=$noticeCaptured;detailsVisibleByDefault=$detailsObserved;estimatedRemainingObserved=$etaCaptured;removalUpdates=$removal.Count;observations=$observations.ToArray()} | ConvertTo-Json -Depth 5 | Set-Content verification/windows-installer-experience.json
} finally {
  $observations.ToArray() | ConvertTo-Json -Depth 5 | Set-Content verification/windows-installer-ui-observations.json
  # A failed UI assertion must not leave this test's installer waiting for a
  # click and holding the runner's process/output handles until job timeout.
  $p.Refresh()
  if (!$p.HasExited) {
    try {
      if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
        Save-InstallerCapture $p.MainWindowHandle (Join-Path (Get-Location) 'verification/windows-installer-failure.png')
      }
    } catch { Write-Warning 'Could not capture the failed installer window' }
    $p.Kill($true)
    [void]$p.WaitForExit(10000)
  }
  # This runner owns only this temporary installation. Close its launched app
  # before the separate installed-app smoke test acquires a profile lock.
  foreach($child in @(Get-Process -Name 'Nubi Workspace' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $appPath})) {
    if($child.MainWindowHandle -ne [IntPtr]::Zero){[void]$child.CloseMainWindow();if(!$child.WaitForExit(10000)){$child.Kill()}}
  }
}
