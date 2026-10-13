param([ValidateSet('x64','x86')][string]$Architecture='x64')
$ErrorActionPreference='Stop'
$vswhere="${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs=& $vswhere -latest -products '*' -property installationPath
$compilerEnvironment=Join-Path $vs 'VC\Auxiliary\Build\vcvarsall.bat'
$output=Join-Path (Get-Location) 'native/OfficeX.Dispatch.Tests/bin/Release/net472'
& dotnet build native/OfficeX.Dispatch.Tests -c Release "-p:PlatformTarget=$Architecture"
if($LASTEXITCODE){throw 'Native dispatch test compile failed'}
$exports=if($Architecture -eq 'x86'){'/EXPORT:CreateExcelFixture=_CreateExcelFixture /EXPORT:GetExcelFixtureStats=_GetExcelFixtureStats'}else{''}
$command="call `"$compilerEnvironment`" $Architecture && cl /nologo /LD /EHsc /std:c++17 native\OfficeX.Dispatch.Tests\ExcelFixture.cpp /Fo`"$output\ExcelFixture.obj`" /link /OUT:`"$output\ExcelFixture.dll`" oleaut32.lib ole32.lib $exports"
& cmd.exe /d /s /c $command
if($LASTEXITCODE){throw 'Excel-shaped COM fixture compile failed'}
& "$output/OfficeX.Dispatch.Tests.exe"
if($LASTEXITCODE){throw "Native dispatch regression failed ($Architecture)"}
