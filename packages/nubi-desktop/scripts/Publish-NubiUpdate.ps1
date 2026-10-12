# Run on a corporate PC with GitHub CLI signed in to code.sdsdev.co.kr.
# Upload immutable installer first. Advance latest only after a remote hash check.
param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
  [Parameter(Mandatory=$true)][string]$NotesFile
)
$ErrorActionPreference = 'Stop'
$hostName = 'code.sdsdev.co.kr'
$repository = 'Manufacturing-IT/nuri'
$fullRepository = "$hostName/$repository"
$tag = "nubi-desktop-v$Version"
$expectedName = "Nubi-Workspace-beta-$Version-x64-Setup.exe"
$source = Get-Item -LiteralPath $Installer
if ($source.Name -cne $expectedName) { throw "Expected installer: $expectedName" }
if ($source.Length -lt 1 -or $source.Length -gt 2GB) { throw 'Invalid installer size' }
$hash = (Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$notes = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $NotesFile), [Text.Encoding]::UTF8).Trim()
if ($notes.Length -gt 4000) { throw 'Release notes must be at most 4000 characters' }
function Gh([string[]]$Arguments) {
  $result = & gh @Arguments
  if ($LASTEXITCODE -ne 0) { throw "GitHub operation failed. Exit: $LASTEXITCODE" }
  return ($result -join "`n")
}
$null = Gh -Arguments @('auth','status','--hostname',$hostName)
$temp = Join-Path ([IO.Path]::GetTempPath()) ('nubi-publish-' + [guid]::NewGuid())
New-Item $temp -ItemType Directory | Out-Null
try {
  # Listing successfully distinguishes first publication from permission/network failures.
  $files = @(ConvertFrom-Json (Gh -Arguments @('api','--hostname',$hostName,"repos/$repository/contents/")))
  $prior = $null
  if ($files.name -contains 'latest') {
    $channel = @(ConvertFrom-Json (Gh -Arguments @('api','--hostname',$hostName,"repos/$repository/contents/latest")))
    if ($channel.name -contains 'windows-x64.json') {
      $prior = ConvertFrom-Json (Gh -Arguments @('api','--hostname',$hostName,"repos/$repository/contents/latest/windows-x64.json"))
      $old = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($prior.content)))
      if ([version]$old.version -ge [version]$Version) { throw 'latest already points to this version or a newer one. Do not downgrade or overwrite a release.' }
    }
  }
  $releases = @(ConvertFrom-Json (Gh -Arguments @('api','--hostname',$hostName,"repos/$repository/releases?per_page=100")))
  $existing = $releases | Where-Object tag_name -eq $tag | Select-Object -First 1
  if (!$existing) {
    $null = Gh -Arguments @('release','create',$tag,'--repo',$fullRepository,'--title',"Nubi Workspace Beta $Version",'--notes-file',(Resolve-Path -LiteralPath $NotesFile).Path,$source.FullName)
  } else {
    if ($existing.draft) { throw 'Release is a draft. Review and publish it before advancing latest.' }
    if (!($existing.assets | Where-Object name -eq $source.Name)) {
      $null = Gh -Arguments @('release','upload',$tag,'--repo',$fullRepository,$source.FullName)
    }
  }
  $release = ConvertFrom-Json (Gh -Arguments @('api','--hostname',$hostName,"repos/$repository/releases/tags/$tag"))
  $asset = $release.assets | Where-Object name -eq $source.Name | Select-Object -First 1
  if (!$asset -or $asset.size -ne $source.Length -or $asset.state -ne 'uploaded') { throw 'Uploaded asset metadata mismatch' }
  $null = Gh -Arguments @('release','download',$tag,'--repo',$fullRepository,'--pattern',$source.Name,'--dir',$temp)
  if ((Get-FileHash -LiteralPath (Join-Path $temp $source.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'Remote installer hash mismatch. latest was not changed.' }
  $manifest = [ordered]@{schemaVersion=1;version=$Version;platform='win32';arch='x64';repository=$repository;tag=$tag;assetId=$asset.id;filename=$source.Name;size=$source.Length;sha256=$hash;notes=$notes}
  $json = ($manifest | ConvertTo-Json -Depth 4) + "`n"
  # Keep a reviewable local copy beside the installer.
  [IO.File]::WriteAllText((Join-Path $source.DirectoryName 'windows-x64.json'),$json,(New-Object Text.UTF8Encoding($false)))
  $body = @{message="release: Nubi Workspace $Version";content=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))}
  if ($prior) { $body.sha=$prior.sha }
  $bodyFile=Join-Path $temp 'request.json'
  [IO.File]::WriteAllText($bodyFile,($body|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
  $saved=ConvertFrom-Json (Gh -Arguments @('api','--hostname',$hostName,'--method','PUT',"repos/$repository/contents/latest/windows-x64.json",'--input',$bodyFile))
  $readback=ConvertFrom-Json (Gh -Arguments @('api','--hostname',$hostName,"repos/$repository/contents/latest/windows-x64.json?ref=$($saved.commit.sha)"))
  if ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($readback.content)) -cne $json) { throw 'Publication readback mismatch. Inspect latest before retrying.' }
  Write-Host "Published $Version. nuri/latest/windows-x64.json is verified."
} finally { Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue }
