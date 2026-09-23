$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'Read-ShellLink.cs')
$folder = Join-Path $env:RUNNER_TEMP ('nubi-link-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder | Out-Null
try {
  $exe = Join-Path $env:WINDIR 'System32\notepad.exe'
  $ascii = Join-Path $folder 'fixture.lnk'
  $unicode = Join-Path $folder '누비 workspace.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($ascii)
  $link.TargetPath = $exe
  $link.IconLocation = "$exe,0"
  $link.Save()
  Move-Item -LiteralPath $ascii -Destination $unicode
  $before = (Get-FileHash -LiteralPath $unicode).Hash
  $actual = [NubiShellLink]::Read($unicode)
  if ($actual[0] -ne $exe -or $actual[1] -ne "$exe,0") { throw 'Unicode shortcut target or icon mismatch' }
  if ((Get-FileHash -LiteralPath $unicode).Hash -ne $before) { throw 'Shortcut read modified the file' }
  Write-Host 'Native Unicode shortcut read passed without modifying the link'
} finally {
  Remove-Item -LiteralPath $folder -Recurse -Force
}
