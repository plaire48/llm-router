$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
$version=(Get-Content package.json -Raw|ConvertFrom-Json).version
$exe=(Resolve-Path "releases/Nubi-Office-X-$version-Setup.exe").Path
$installPath=Join-Path $env:ProgramFiles 'Nubi Office X'
function RunInstaller($path,$log){
 $timer=[Diagnostics.Stopwatch]::StartNew()
 $process=Start-Process $path -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/LOG=`"$log`"") -Wait -PassThru
 if($process.ExitCode -notin @(0,3010)){throw "Installer exit $($process.ExitCode), see $log"}
 return [math]::Round($timer.Elapsed.TotalSeconds,2)
}
$install=RunInstaller $exe "$projectRoot/releases/install.log"
$registry=@()
foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)){
 $hive=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,$view)
 try {foreach($app in @('Excel','Word','PowerPoint')){
  $key=$hive.OpenSubKey("Software\Microsoft\Office\$app\Addins\OfficeX.GenOffice")
  if(!$key){throw "$app registration missing ($view)"}
  try{$manifest=$key.GetValue('Manifest');if($key.GetValue('LoadBehavior') -ne 3 -or $manifest -notlike "*OfficeX.$($app)AddIn.vsto|vstolocal"){throw 'Invalid registration'};$registry+=@{app=$app;view="$view";manifest=$manifest}}finally{$key.Dispose()}
 }}finally{$hive.Dispose()}
}
foreach($file in @('OfficeX.ExcelAddIn.vsto','OfficeX.WordAddIn.vsto','OfficeX.PowerPointAddIn.vsto','OfficeX.ExcelHost.dll','OfficeX/runtime/node.exe','OfficeX/worker/main.cjs','OfficeX/ui/index.html')){if(!(Test-Path "$installPath/$file")){throw "Missing installed $file"}}
& "$installPath/OfficeX/runtime/node.exe" --version
if($LASTEXITCODE){throw 'Bundled Node cannot run'}
$reinstall=RunInstaller $exe "$projectRoot/releases/reinstall.log"
$uninstall=RunInstaller "$installPath/unins000.exe" "$projectRoot/releases/uninstall.log"
foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)){
 $hive=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,$view)
 try{foreach($app in @('Excel','Word','PowerPoint')){if($hive.OpenSubKey("Software\Microsoft\Office\$app\Addins\OfficeX.GenOffice")){throw 'Uninstall left registration'}}}finally{$hive.Dispose()}
}
if(Test-Path "$installPath/OfficeX/runtime/node.exe"){throw 'Uninstall left runtime'}
@{passed=$true;installSeconds=$install;reinstallSeconds=$reinstall;uninstallSeconds=$uninstall;registry=$registry;runner='windows-2022';officeInstalled=$false;realOfficeVerified=$false;liveModelVerified=$false}|ConvertTo-Json -Depth 4|Set-Content releases/install-smoke.json
