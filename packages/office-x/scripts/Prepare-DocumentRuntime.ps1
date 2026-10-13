param([string]$Destination=(Join-Path $PSScriptRoot '../dist/worker/document-runtime'))
$ErrorActionPreference='Stop'
$uvVersion='0.13.0'
$expected='088962f9e7b7bd9ea740c04c650b2a21c8928c345bd99ac24350dc924dba656c'
$url="https://github.com/astral-sh/uv/releases/download/$uvVersion/uv-x86_64-pc-windows-msvc.zip"
New-Item $Destination -ItemType Directory -Force|Out-Null
$temp=Join-Path $env:TEMP ('nubi-doc-runtime-'+[Guid]::NewGuid().ToString('N'))
New-Item $temp -ItemType Directory|Out-Null
try {
 $zip=Join-Path $temp 'uv.zip';Invoke-WebRequest $url -OutFile $zip
 if((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $expected){throw 'Document runtime checksum mismatch'}
 Expand-Archive $zip (Join-Path $temp 'unpacked')
 $binary=Get-ChildItem (Join-Path $temp 'unpacked') -Filter uv.exe -Recurse|Select-Object -First 1
 if(!$binary){throw 'Document runtime binary missing'}
 Copy-Item $binary.FullName (Join-Path $Destination 'uv.exe')
 $licenses=Join-Path $Destination 'licenses';New-Item $licenses -ItemType Directory -Force|Out-Null
 foreach($name in @('LICENSE-APACHE','LICENSE-MIT')){Invoke-WebRequest "https://raw.githubusercontent.com/astral-sh/uv/$uvVersion/$name" -OutFile (Join-Path $licenses $name)}
 @{uv=$uvVersion;sha256=$expected;source=$url;python='3.12.12';markitdown='0.1.8';docling='2.138.0';provisioning='on-demand';documentUpload=$false;office32OnWindows64=$true;pythonWindows32=$false}|ConvertTo-Json|Set-Content (Join-Path $Destination 'runtime.json') -Encoding UTF8
}finally{Remove-Item $temp -Recurse -Force}
