param([string]$OfficeRoot,[string]$NodePath='node')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
if(!$OfficeRoot){$OfficeRoot=Join-Path $projectRoot 'dist'}
$probe=Join-Path $OfficeRoot 'cli/document-engine-probe.cjs'
$temp=Join-Path $env:TEMP ('nubi-installed-markdown-'+[Guid]::NewGuid().ToString('N'))
New-Item $temp -ItemType Directory|Out-Null
$rows=@();$watch=[Diagnostics.Stopwatch]::StartNew()
try {
 $html=Join-Path $temp 'first.html';[IO.File]::WriteAllText($html,'<h1>First Markdown</h1><p>Original content 1200</p>',[Text.UTF8Encoding]::new($false))
 function Convert-Installed([string]$Path,[string[]]$Expected){
  $request=@{root=$temp;path=$Path;engine='auto'}|ConvertTo-Json -Compress
  $output=$request|& $NodePath $probe
  if($LASTEXITCODE){throw "Installed Markdown tool failed: $output"}
  $result=$output|Select-Object -Last 1|ConvertFrom-Json
  $text=[IO.File]::ReadAllText($result.output).Replace('\','')
  foreach($value in $Expected){if(!$text.Contains($value)){throw "Markdown omitted fixture text: $value"}}
  if((Get-FileHash $result.output).Hash.ToLower() -ne $result.sha256){throw 'Installed Markdown hash mismatch'}
  if($result.quality.missingUnits -ne 0){throw 'Installed Markdown quality failed'}
  return @{file=[IO.Path]::GetFileName($Path);status=$result.status;engines=$result.engines;quality=$result.quality;warnings=$result.warnings;sha256=$result.sha256}
 }
 $rows+=Convert-Installed $html @('First Markdown','Original content 1200')
 $python=Join-Path $env:LOCALAPPDATA 'OfficeX/DocumentRuntime/markitdown-v1/Scripts/python.exe'
 & $python (Join-Path $projectRoot 'tests/fixtures/markdown-documents.py') $temp
 if($LASTEXITCODE){throw 'Document corpus generation failed'}
 $rows+=Convert-Installed (Join-Path $temp 'report.docx') @('원문 보존','서울','머리글 보존')
 $rows+=Convert-Installed (Join-Path $temp 'book.xlsx') @('SUM(B2:B3)','먼 셀 값','2026-10-14','A7:C7')
 $rows+=Convert-Installed (Join-Path $temp 'deck.pptx') @('누비 발표','첫 번째 본문','발표자 노트 보존')
 $rows+=Convert-Installed (Join-Path $temp 'scanned.pdf') @('누비','문서','읽기','1200','MARKDOWN')
 if($rows[-1].engines -notcontains 'docling'){throw 'OCR must use actual Docling, not text fallback'}
 if($rows[-1].quality.complete -ne $false){throw 'OCR source fidelity must require review'}
 $watch.Stop();New-Item (Join-Path $projectRoot 'verification') -ItemType Directory -Force|Out-Null
 @{passed=$true;actualInstalledRuntime=$true;actualConverters=$true;actualOffice=$false;seconds=$watch.Elapsed.TotalSeconds;rows=$rows}|ConvertTo-Json -Depth 10|Set-Content (Join-Path $projectRoot 'verification/installed-markdown.json') -Encoding UTF8
}finally{Remove-Item $temp -Recurse -Force}
