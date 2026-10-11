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
  "$env:PYTHONIOENCODING = 'utf-8'",
].join('; ') + ';\n';
