$ErrorActionPreference = 'Stop'
function Stage([string]$name) {
  Write-Host ("Nubi installer stage: " + $name + " at " + (Get-Date).ToUniversalTime().ToString('o'))
  @{ stage=$name; at=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress | Add-Content verification/windows-installer-stages.jsonl
}
Stage 'install'
$installer = Get-ChildItem release/windows/*-Setup.exe | Select-Object -First 1
if (!$installer) { throw 'Installer missing' }
$target = Join-Path $env:RUNNER_TEMP 'NubiInstalled'
$upgradeVerified = $false
if ($env:NUBI_BASELINE_INSTALLER) {
  Stage 'baseline-install'
  $baseline = Start-Process $env:NUBI_BASELINE_INSTALLER -ArgumentList @('/S', "/D=$target") -Wait -PassThru
  if ($baseline.ExitCode -ne 0 -or !(Test-Path (Join-Path $target 'Nubi Workspace.exe'))) { throw 'Baseline install failed' }
  $upgradeVerified = $true
  Stage 'upgrade'
}
$p = Start-Process $installer.FullName -ArgumentList @('/S', "/D=$target") -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Installer failed: $($p.ExitCode)" }
$exe = Join-Path $target 'Nubi Workspace.exe'
if (!(Test-Path $exe)) { throw 'Installed executable missing' }
Stage 'branding'
$expectedName = '누비 Workspace beta'
$metadata = (Get-Item $exe).VersionInfo
if ($metadata.ProductName -ne $expectedName) { throw "Unexpected product name: $($metadata.ProductName)" }
$iconFile = Join-Path $target 'resources/nubi-icon.png'
$master = Resolve-Path '../../extensions/aipro-chat/design/brand/bird-master.png'
if ((Get-FileHash $iconFile).Hash -ne (Get-FileHash $master).Hash) { throw 'Packaged bird icon differs from approved master' }
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
if (!$icon) { throw 'Executable icon missing' }
$bitmap = $icon.ToBitmap()
$bitmap.Save((Join-Path (Get-Location) 'verification/installed-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose(); $icon.Dispose()
$shell = New-Object -ComObject WScript.Shell
$links = @()
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  if (Test-Path $folder) {
    foreach ($file in Get-ChildItem $folder -Filter '*.lnk' -Recurse) {
      $shortcut = $shell.CreateShortcut($file.FullName)
      if ($shortcut.TargetPath -eq $exe) {
        if ($file.BaseName -ne $expectedName) { throw "Unexpected shortcut name: $($file.BaseName)" }
        $links += @{ name=$file.BaseName; target=($shortcut.TargetPath | Split-Path -Leaf); icon=($shortcut.IconLocation | Split-Path -Leaf) }
      }
    }
  }
}
if ($links.Count -lt 1) { throw 'Named app shortcut missing' }
$registration = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -like "$expectedName*" })
if ($registration.Count -ne 1) { throw 'App uninstall name missing or ambiguous' }
@{ productName=$metadata.ProductName; fileVersion=$metadata.FileVersion; iconMatchesMaster=$true; shortcuts=$links; uninstallName=$registration[0].DisplayName } | ConvertTo-Json -Depth 4 | Set-Content verification/windows-branding.json

$env:NUBI_TEST_EXECUTABLE = $exe
Stage 'first-launch'
node scripts/check-electron.mjs
if ($LASTEXITCODE -ne 0) { throw 'Installed app smoke failed' }
Copy-Item verification/electron-release.json verification/electron-first-install.json
Stage 'reinstall'
$p = Start-Process $installer.FullName -ArgumentList @('/S', "/D=$target") -Wait -PassThru
if ($p.ExitCode -ne 0) { throw 'Reinstall failed' }
Stage 'second-launch'
node scripts/check-electron.mjs
if ($LASTEXITCODE -ne 0) { throw 'Reinstalled app smoke failed' }
Stage 'uninstall'
$uninstall = Get-ChildItem $target/*Uninstall*.exe | Select-Object -First 1
if (!$uninstall) { throw 'Uninstaller missing' }
$p = Start-Process $uninstall.FullName -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Uninstall failed: $($p.ExitCode)" }
for ($i = 0; $i -lt 20 -and (Test-Path $exe); $i++) { Start-Sleep -Seconds 1 }
if (Test-Path $exe) { throw 'Uninstall did not remove application' }
@{ upgradeFromPrevious=$upgradeVerified; install=$true; launch=$true; reinstall=$true; reinstallLaunch=$true; uninstall=$true; authenticode=(Get-AuthenticodeSignature $installer.FullName).Status.ToString(); windows=(Get-CimInstance Win32_OperatingSystem).Caption } | ConvertTo-Json | Set-Content verification/windows-installer.json
(Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLower() + '  ' + $installer.Name | Set-Content ($installer.FullName + '.sha256')

Stage 'complete'
