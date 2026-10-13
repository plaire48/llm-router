param([ValidateSet('x64','x86')][string]$Architecture='x64')
$ErrorActionPreference='Stop'
$vswhere="${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs=& $vswhere -latest -products '*' -property installationPath
$compilerEnvironment=Join-Path $vs 'VC\Auxiliary\Build\vcvarsall.bat'
$toolset=Get-ChildItem (Join-Path $vs 'VC/Tools/MSVC') -Directory|Sort-Object Name -Descending|Select-Object -First 1
$compiler=Join-Path $toolset.FullName "bin/Hostx64/$Architecture/cl.exe"
$output=Join-Path (Get-Location) 'native/OfficeX.Dispatch.Tests/bin/Release/net472'
& dotnet build native/OfficeX.Dispatch.Tests -t:Rebuild -c Release "-p:PlatformTarget=$Architecture"
if($LASTEXITCODE){throw 'Native dispatch test compile failed'}
$definition=Join-Path $output 'ExcelFixture.def'
"EXPORTS`nCreateExcelFixture`nGetExcelFixtureStats`nSetExcelFixtureCopyFailure`nGetExcelFixtureCopyAttempts`nSetExcelFixtureActiveSheet"|Set-Content $definition -Encoding ascii
$command="call `"$compilerEnvironment`" $Architecture && `"$compiler`" /nologo /LD /EHsc /std:c++17 native\OfficeX.Dispatch.Tests\ExcelFixture.cpp /Fo`"$output\ExcelFixture.obj`" /link /MACHINE:$Architecture /OUT:`"$output\ExcelFixture.dll`" /DEF:`"$definition`" /IMPLIB:`"$output\ExcelFixture.lib`" oleaut32.lib ole32.lib"
& cmd.exe /d /s /c $command
if($LASTEXITCODE){throw 'Excel-shaped COM fixture compile failed'}
& "$output/OfficeX.Dispatch.Tests.exe" $Architecture
if($LASTEXITCODE){throw "Native dispatch regression failed ($Architecture)"}
