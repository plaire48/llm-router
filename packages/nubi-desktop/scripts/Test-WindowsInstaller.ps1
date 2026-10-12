$ErrorActionPreference = 'Stop'
New-Item verification -ItemType Directory -Force | Out-Null
Add-Type -Path (Join-Path $PSScriptRoot 'Read-ShellLink.cs')
function Stage([string]$name) {
  Write-Host ("Nubi installer stage: " + $name + " at " + (Get-Date).ToUniversalTime().ToString('o'))
  @{ stage=$name; at=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress | Add-Content verification/windows-installer-stages.jsonl
}
function Get-AppShortcuts {
  $shell = New-Object -ComObject WScript.Shell
  $result = @()
  foreach ($kind in @('DesktopDirectory', 'Programs', 'CommonDesktopDirectory', 'CommonPrograms')) {
    $folder = [Environment]::GetFolderPath($kind)
    if ($folder -and (Test-Path $folder)) {
      foreach ($file in Get-ChildItem $folder -Filter '*.lnk' -Recurse -Force | Where-Object { $_.BaseName -in @('Nubi Workspace','누비 Workspace beta','누비 beta','누비 workspace') }) {
        $shortcut = $shell.CreateShortcut($file.FullName)
        $native = [NubiShellLink]::Read($file.FullName)
        $result += @{ folder=$kind; path=$file.FullName; name=$file.BaseName; target=$native[0]; icon=$native[1]; legacyTarget=$shortcut.TargetPath }
      }
    }
  }
  return $result
}
Stage 'install'
$installer = Get-ChildItem release/windows/*-Setup.exe | Select-Object -First 1
if (!$installer) { throw 'Installer missing' }
$target = Join-Path $env:RUNNER_TEMP 'Nubi Workspace'
$upgradeVerified = $false
$durations=@{}
$stopwatch=[Diagnostics.Stopwatch]::StartNew()
if ($env:NUBI_BASELINE_INSTALLER) {
  Stage 'baseline-install'
  $baseline = Start-Process $env:NUBI_BASELINE_INSTALLER -ArgumentList @('/S', "/D=$target") -Wait -PassThru
  if ($baseline.ExitCode -ne 0 -or !(Test-Path (Join-Path $target 'Nubi Workspace.exe'))) { throw 'Baseline install failed' }
  @(Get-AppShortcuts) | ConvertTo-Json -Depth 4 | Set-Content verification/windows-baseline-shortcuts.json
  $durations.baselineSeconds=$stopwatch.Elapsed.TotalSeconds
  $upgradeVerified = $true
  Stage 'upgrade'
}
$stopwatch.Restart()
& (Join-Path $PSScriptRoot 'Test-InstallerExperience.ps1') -Installer $installer.FullName -Target $target
$durations.upgradeSeconds=$stopwatch.Elapsed.TotalSeconds
$exe = Join-Path $target 'Nubi Workspace.exe'
if (!(Test-Path $exe)) { throw 'Installed executable missing' }
node scripts/check-installed-archive.mjs $target
if ($LASTEXITCODE -ne 0) {throw 'Installed archive checks failed'}
Stage 'branding'
$expectedName = '누비 Workspace'
$expectedVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
$metadata = (Get-Item $exe).VersionInfo
if ($metadata.ProductName -ne $expectedName) { throw "Unexpected product name: $($metadata.ProductName)" }
if ($metadata.FileVersion -ne $expectedVersion) { throw "Unexpected file version: $($metadata.FileVersion)" }
$iconFile = Join-Path $target 'resources/nubi-icon.png'
$master = Resolve-Path '../../extensions/aipro-chat/design/brand/bird-master.png'
if ((Get-FileHash $iconFile).Hash -ne (Get-FileHash $master).Hash) { throw 'Packaged bird icon differs from approved master' }
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
if (!$icon) { throw 'Executable icon missing' }
$bitmap = $icon.ToBitmap()
$bitmap.Save((Join-Path (Get-Location) 'verification/installed-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose(); $icon.Dispose()
$observedLinks = @(Get-AppShortcuts)
$observedLinks | ConvertTo-Json -Depth 4 | Set-Content verification/windows-observed-shortcuts.json
$links = @($observedLinks | Where-Object { $_.target -eq $exe })
foreach ($link in $links) {
  if ($link.name -ne $expectedName) { throw "Unexpected shortcut name: $($link.name)" }
  if ($link.folder -like 'Common*') { throw 'Per-user installer created an all-users shortcut' }
}
if ($links.Count -ne 2 -or 'DesktopDirectory' -notin $links.folder -or 'Programs' -notin $links.folder) { throw 'Named desktop and Start menu shortcuts required' }
foreach ($link in $links) { if ($link.icon -ne "$exe,0") { throw 'Shortcut icon does not reference the installed executable' } }
$registration = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -like "$expectedName*" })
if ($registration.Count -ne 1 -or $registration[0].DisplayName -ne "$expectedName Beta $expectedVersion") { throw 'App uninstall name missing or ambiguous' }
@{ productName=$metadata.ProductName; fileVersion=$metadata.FileVersion; iconMatchesMaster=$true; shortcuts=$links; uninstallName=$registration[0].DisplayName } | ConvertTo-Json -Depth 4 | Set-Content verification/windows-branding.json

$env:NUBI_TEST_EXECUTABLE = $exe
$env:NUBI_TEST_WITHOUT_GIT = '1'
Stage 'first-launch'
node scripts/check-electron-shell.mjs
if ($LASTEXITCODE -ne 0) { throw 'Installed app smoke failed' }
Copy-Item verification/electron-shell.json verification/electron-first-install.json
Stage 'project-navigation'
node scripts/check-electron-projects.mjs
if ($LASTEXITCODE -ne 0) { throw 'Installed project navigation and source checks failed' }
Stage 'reinstall'
$stopwatch.Restart()
$p = Start-Process $installer.FullName -ArgumentList @('/S', "/D=$target") -Wait -PassThru
if ($p.ExitCode -ne 0) { throw 'Reinstall failed' }
$durations.reinstallSeconds=$stopwatch.Elapsed.TotalSeconds
Stage 'second-launch'
node scripts/check-electron-shell.mjs
if ($LASTEXITCODE -ne 0) { throw 'Reinstalled app smoke failed' }
Stage 'silent-update-and-relaunch'
$p = Start-Process $installer.FullName -ArgumentList @('/S', '--updated', '--force-run', "/D=$target") -Wait -PassThru
if ($p.ExitCode -ne 0) { throw 'Silent update failed' }
$launched = $null
for ($i=0; $i -lt 30 -and !$launched; $i++) {
  $launched = @(Get-Process | Where-Object { $_.Path -eq $exe })
  if (!$launched) { Start-Sleep -Seconds 1 }
}
if (!$launched) { throw 'Updated app did not relaunch' }
$launched | Stop-Process -Force
Start-Sleep -Seconds 2
Stage 'uninstall'
$stopwatch.Restart()
$uninstall = Get-ChildItem $target/*Uninstall*.exe | Select-Object -First 1
if (!$uninstall) { throw 'Uninstaller missing' }
$p = Start-Process $uninstall.FullName -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Uninstall failed: $($p.ExitCode)" }
for ($i = 0; $i -lt 20 -and (Test-Path $exe); $i++) { Start-Sleep -Seconds 1 }
if (Test-Path $exe) { throw 'Uninstall did not remove application' }
$durations.uninstallSeconds=$stopwatch.Elapsed.TotalSeconds
@{ durations=$durations; upgradeFromPrevious=$upgradeVerified; install=$true; launch=$true; reinstall=$true; reinstallLaunch=$true; silentUpdateRelaunch=$true; withoutSystemGit=$true; uninstall=$true; authenticode=(Get-AuthenticodeSignature $installer.FullName).Status.ToString(); windows=(Get-CimInstance Win32_OperatingSystem).Caption } | ConvertTo-Json | Set-Content verification/windows-installer.json
(Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLower() + '  ' + $installer.Name | Set-Content ($installer.FullName + '.sha256')

Stage 'complete'
