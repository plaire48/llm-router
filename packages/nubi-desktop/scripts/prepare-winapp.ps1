$ErrorActionPreference = 'Stop'
$commit = 'd626d2b53b9eea27ae2972e9153ce0b1d4c52825'
$source = if ($env:NUBI_WINAPP_SOURCE) { $env:NUBI_WINAPP_SOURCE } else { Join-Path $env:GITHUB_WORKSPACE '.build/winapp' }
if ((git -C $source rev-parse HEAD) -ne $commit) { throw 'winapp source commit mismatch' }
$patch = Join-Path (Get-Location) 'vendor/patches/winapp-password.patch'
git -C $source apply --check --unidiff-zero $patch
if ($LASTEXITCODE -ne 0) { throw 'winapp password patch no longer matches source' }
git -C $source apply --unidiff-zero $patch
if ($LASTEXITCODE -ne 0) { throw 'winapp password patch failed' }
$patchHash = (Get-FileHash $patch -Algorithm SHA256).Hash.ToLower()
$destination = Join-Path (Get-Location) 'generated/winapp'
New-Item $destination -ItemType Directory -Force | Out-Null
# 0.6.0 lacks the DPI/coordinate contract. Build the reviewed upstream source; do not guess DPI.
dotnet publish (Join-Path $source 'src/winapp-CLI/WinApp.Cli/WinApp.Cli.csproj') -c Release -r win-x64 -o $destination
if ($LASTEXITCODE -ne 0) { throw 'winapp publish failed' }
$exe = Join-Path $destination 'winapp.exe'
if (!(Test-Path $exe)) { throw 'winapp layout changed' }
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
@{ version="source-$($commit.Substring(0,12))"; commit=$commit; passwordPatchSha256=$patchHash; sha256=$hash; source="https://github.com/microsoft/winappCli/tree/$commit" } | ConvertTo-Json | Set-Content (Join-Path $destination 'manifest.json') -Encoding utf8NoBOM
Copy-Item (Join-Path $source 'LICENSE') (Join-Path $destination 'LICENSE')
Get-ChildItem $destination -Filter '*.pdb' | Remove-Item
Copy-Item $patch (Join-Path $destination 'winapp-password.patch')
