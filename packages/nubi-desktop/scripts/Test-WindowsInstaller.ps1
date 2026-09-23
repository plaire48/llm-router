$ErrorActionPreference = 'Stop'
$installer = Get-ChildItem release/windows/*-Setup.exe | Select-Object -First 1
if (!$installer) { throw 'Installer missing' }
$target = Join-Path $env:RUNNER_TEMP 'NubiInstalled'
$p = Start-Process $installer.FullName -ArgumentList @('/S', "/D=$target") -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Installer failed: $($p.ExitCode)" }
$exe = Join-Path $target 'Nubi Workspace.exe'
if (!(Test-Path $exe)) { throw 'Installed executable missing' }
$env:NUBI_TEST_EXECUTABLE = $exe
node scripts/check-electron.mjs
if ($LASTEXITCODE -ne 0) { throw 'Installed app smoke failed' }
Copy-Item verification/electron-release.json verification/electron-first-install.json
$p = Start-Process $installer.FullName -ArgumentList @('/S', "/D=$target") -Wait -PassThru
if ($p.ExitCode -ne 0) { throw 'Reinstall failed' }
node scripts/check-electron.mjs
if ($LASTEXITCODE -ne 0) { throw 'Reinstalled app smoke failed' }
$uninstall = Get-ChildItem $target/*Uninstall*.exe | Select-Object -First 1
if (!$uninstall) { throw 'Uninstaller missing' }
$p = Start-Process $uninstall.FullName -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Uninstall failed: $($p.ExitCode)" }
for ($i = 0; $i -lt 20 -and (Test-Path $exe); $i++) { Start-Sleep -Seconds 1 }
if (Test-Path $exe) { throw 'Uninstall did not remove application' }
@{ install=$true; launch=$true; reinstall=$true; reinstallLaunch=$true; uninstall=$true; authenticode=(Get-AuthenticodeSignature $installer.FullName).Status.ToString(); windows=(Get-CimInstance Win32_OperatingSystem).Caption } | ConvertTo-Json | Set-Content verification/windows-installer.json
(Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLower() + '  ' + $installer.Name | Set-Content ($installer.FullName + '.sha256')
