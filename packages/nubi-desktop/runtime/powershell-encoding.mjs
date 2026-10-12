// Keep PowerShell text transport explicit without changing file encodings,
// the user's profile, execution policy or the Windows system locale.
export const POWERSHELL_TEXT_ARGS = [
  '-NoLogo', '-NoProfile', '-NonInteractive',
  '-InputFormat', 'Text', '-OutputFormat', 'Text',
];
export const POWERSHELL_UTF8_PREFIX = [
  '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '$OutputEncoding = [Console]::OutputEncoding',
  // Windows PowerShell 5.1 reads BOM-less UTF-8 source as the ANSI code page.
  // Scope the read default to this child only; explicit -Encoding still wins.
  // Never alter output-file encodings, source bytes, profiles or system locale.
  "$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'",
  "$env:PYTHONIOENCODING = 'utf-8'",
].join('; ') + ';\n';
