param([string]$CertificateThumbprint,[string]$NuGetPath='nuget',[string]$InnoSetupPath,[switch]$InstallBuildTools)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$projectRoot=Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
 $version=(Get-Content package.json -Raw|ConvertFrom-Json).version
 New-Item releases -ItemType Directory -Force|Out-Null
 $vswhere="${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
 $vs=& $vswhere -latest -version '[17.0,18.0)' -products '*' -property installationPath
 if(!$vs){throw 'Visual Studio 2022 is required'}
 $targets=Join-Path $vs 'MSBuild\Microsoft\VisualStudio\v17.0\OfficeTools\Microsoft.VisualStudio.Tools.Office.targets'
 if(!(Test-Path $targets) -and $InstallBuildTools){
  $setup="${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
  $p=Start-Process $setup -ArgumentList @('modify','--installPath',"`"$vs`"",'--add','Microsoft.VisualStudio.Workload.Office','--includeRecommended','--quiet','--norestart') -Wait -PassThru
  if($p.ExitCode -notin @(0,3010)){throw "VSTO tools setup failed: $($p.ExitCode)"}
 }
 if(!(Test-Path $targets)){throw 'Install the Visual Studio Office development workload'}
 $msbuild=Join-Path $vs 'MSBuild\Current\Bin\MSBuild.exe'
 & npm.cmd ci --ignore-scripts
 if($LASTEXITCODE){throw 'npm ci failed'}
 & npm.cmd run build
 if($LASTEXITCODE){throw 'UI/worker build failed'}
 & npm.cmd run typecheck
 if($LASTEXITCODE){throw 'Typecheck failed'}
 & npm.cmd test
 if($LASTEXITCODE){throw 'Unit tests failed'}
 & dotnet run --project native/OfficeX.Core.Tests -c Release
 if($LASTEXITCODE){throw 'Native core tests failed'}
 & dotnet build native/OfficeX.ExcelHost -c Release
 if($LASTEXITCODE){throw 'Native host build failed'}
 $interop=@{}
 foreach($entry in @(@('MicrosoftOfficeCore','15.0.0','Office.dll','OfficeCorePath'),@('Microsoft.Office.Interop.Excel','15.0.4795.1001','Microsoft.Office.Interop.Excel.dll','ExcelInteropPath'),@('Microsoft.Office.Interop.Word','15.0.4797.1004','Microsoft.Office.Interop.Word.dll','WordInteropPath'),@('Microsoft.Office.Interop.PowerPoint','15.0.4420.1018','Microsoft.Office.Interop.PowerPoint.dll','PowerPointInteropPath'))){
  & $NuGetPath install $entry[0] -Version $entry[1] -OutputDirectory native/packages -NonInteractive
  if($LASTEXITCODE){throw 'PIA restore failed'}
  $interop[$entry[3]]=Get-ChildItem "native/packages/$($entry[0]).$($entry[1])" -Filter $entry[2] -Recurse|Select-Object -First 1 -ExpandProperty FullName
 }
 $preview=!$CertificateThumbprint
 if($preview){$cert=New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=Nubi Office X Preview' -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(2);$CertificateThumbprint=$cert.Thumbprint}
 try {
  foreach($app in @('Excel','Word','PowerPoint')){
   $args=@('/t:Build','/p:Configuration=Release',"/p:ManifestCertificateThumbprint=$CertificateThumbprint",'/p:VisualStudioVersion=17.0','/nologo','/v:minimal')
   foreach($key in $interop.Keys){$args+="/p:$key=$($interop[$key])"}
   & $msbuild "native/OfficeX.$($app)AddIn/OfficeX.$($app)AddIn.vbproj" @args
   if($LASTEXITCODE){throw "$app VSTO build failed"}
  }
 } finally {if($preview){Remove-Item "Cert:\CurrentUser\My\$CertificateThumbprint" -ErrorAction SilentlyContinue}}
 $stage=Join-Path $projectRoot 'installer/stage'
 if(Test-Path $stage){Remove-Item $stage -Recurse -Force}
 New-Item "$stage/OfficeX" -ItemType Directory -Force|Out-Null
 foreach($app in @('Excel','Word','PowerPoint')){Copy-Item "native/OfficeX.$($app)AddIn/bin/Release/*" $stage -Recurse -Force}
 Copy-Item native/OfficeX.ExcelHost/bin/Release/net472/* $stage -Recurse -Force
 foreach($part in @('ui','worker','licenses')){Copy-Item "dist/$part" "$stage/OfficeX" -Recurse}
 Copy-Item installer/INSTALL-KO.txt $stage
 foreach($name in @('office.dll','Microsoft.Office.Interop.Excel.dll','Microsoft.Office.Interop.Word.dll','Microsoft.Office.Interop.PowerPoint.dll','Microsoft.Vbe.Interop.dll')){if(Test-Path "$stage/$name"){throw "PIA must be embedded: $name"}}
 $inventory=@()
 New-Item installer/prerequisites -ItemType Directory -Force|Out-Null
 foreach($item in @(@{Name='vstor_redist.exe';Url='https://download.microsoft.com/download/5/d/2/5d24f8f8-efbb-4b63-aa33-3785e3104713/vstor_redist.exe'},@{Name='MicrosoftEdgeWebview2Setup.exe';Url='https://go.microsoft.com/fwlink/p/?LinkId=2124703'})){
  $path="installer/prerequisites/$($item.Name)";Invoke-WebRequest $item.Url -OutFile $path
  $signature=Get-AuthenticodeSignature $path
  if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw "Prerequisite signature invalid: $path"}
  $inventory+=@{name=$item.Name;sha256=(Get-FileHash $path).Hash;source=$item.Url}
 }
 $nodeVersion='22.23.2'
 $hashes=(Invoke-WebRequest "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt").Content
 foreach($arch in @('x64','x86')){
  $name="node-v$nodeVersion-win-$arch.zip";$zip="installer/$name"
  Invoke-WebRequest "https://nodejs.org/dist/v$nodeVersion/$name" -OutFile $zip
  $expected=($hashes -split "`n"|Where-Object {$_ -match "  $([regex]::Escape($name))$"}).Split(' ')[0]
  if(!$expected -or (Get-FileHash $zip).Hash -ne $expected){throw "Node checksum mismatch: $name"}
  Expand-Archive $zip "installer/node-$arch" -Force
  New-Item "installer/runtime/$arch" -ItemType Directory -Force|Out-Null
  Copy-Item "installer/node-$arch/node-v$nodeVersion-win-$arch/node.exe" "installer/runtime/$arch/node.exe"
  Copy-Item "installer/node-$arch/node-v$nodeVersion-win-$arch/LICENSE" "$stage/OfficeX/licenses/Node-LICENSE.txt" -Force
  $inventory+=@{name=$name;sha256=$expected;source="https://nodejs.org/dist/v$nodeVersion/$name"}
 }
 if(!$InnoSetupPath){$InnoSetupPath="${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"}
 & $InnoSetupPath "/DAppVersion=$version" installer/OfficeX.iss
 if($LASTEXITCODE){throw 'Installer compile failed'}
 $exe=Get-Item "releases/Nubi-Office-X-$version-Setup.exe"
 "$((Get-FileHash $exe).Hash.ToLower())  $($exe.Name)"|Set-Content "$($exe.FullName).sha256" -Encoding ascii
 @{version=$version;commit=$env:GITHUB_SHA;bytes=$exe.Length;manifestSigning='self-signed preview';installerAuthenticode='unsigned';compression='zip/7, non-solid';prerequisites=$inventory;components=@('excel','word','powerpoint');realOfficeVerified=$false;liveModelVerified=$false}|ConvertTo-Json -Depth 5|Set-Content releases/installer-build.json
} finally {Pop-Location}
