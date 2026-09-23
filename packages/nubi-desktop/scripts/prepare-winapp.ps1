$ErrorActionPreference = 'Stop'
$archive = Join-Path $env:RUNNER_TEMP 'nubi-winapp-0.6.0-x64.zip'
Invoke-WebRequest 'https://github.com/microsoft/winappCli/releases/download/v0.6.0/winappcli-x64.zip' -OutFile $archive
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne 'f6dc42e3b4e4709c8f617003008e2cfdd9a51735e04e7170d60edda258db78a8') { throw 'winapp archive hash mismatch' }
$destination = Join-Path (Get-Location) 'generated/winapp'
New-Item $destination -ItemType Directory -Force | Out-Null
Expand-Archive $archive -DestinationPath $destination -Force
$exe = Join-Path $destination 'winapp.exe'
if (!(Test-Path $exe)) { throw 'winapp layout changed' }
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
@{ version='0.6.0'; sha256=$hash; source='https://github.com/microsoft/winappCli/releases/tag/v0.6.0' } | ConvertTo-Json | Set-Content (Join-Path $destination 'manifest.json') -Encoding utf8NoBOM
Invoke-WebRequest 'https://raw.githubusercontent.com/microsoft/winappCli/v0.6.0/LICENSE' -OutFile (Join-Path $destination 'LICENSE')
Remove-Item (Join-Path $destination 'winapp.pdb') -ErrorAction SilentlyContinue
