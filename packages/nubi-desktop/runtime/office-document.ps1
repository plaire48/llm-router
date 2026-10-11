# Office 2016 COM, executed in an STA process. UTF-8 JSON is the only output.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$app = $null; $document = $null; $collection = $null
$oldSecurity = $null; $oldEvents = $null; $oldAlerts = $null
$reply = $null; $beforeProcesses = @(); $processName = ''
$script:characters = 0; $script:shapeCount = 0
$segments = New-Object 'System.Collections.Generic.List[object]'
function Release-Com($value) {
  if ($null -ne $value -and [Runtime.InteropServices.Marshal]::IsComObject($value)) {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($value)
  }
}
function Check-Text([string]$text) {
  $script:characters += $text.Length
  if ($script:characters -gt 100000) { throw 'document_limit' }
  return $text
}
function Read-Shape($shape, [int]$depth = 0) {
  if ($depth -gt 16 -or ++$script:shapeCount -gt 10000) { throw 'document_limit' }
  $parts = New-Object 'System.Collections.Generic.List[string]'
  $frame = $null; $range = $null; $table = $null; $groups = $null
  try {
    if ($shape.Type -eq 6) {
      $groups = $shape.GroupItems
      for ($i = 1; $i -le $groups.Count; $i++) {
        $child = $groups.Item($i)
        try { $parts.Add((Read-Shape $child ($depth + 1))) } finally { Release-Com $child }
      }
    } elseif ($shape.HasTable -eq -1) {
      $table = $shape.Table; $rows = $table.Rows; $columns = $table.Columns
      try { $rowCount = $rows.Count; $columnCount = $columns.Count } finally { Release-Com $rows; Release-Com $columns }
      if ($rowCount * $columnCount -gt 20000) { throw 'document_limit' }
      for ($r = 1; $r -le $rowCount; $r++) {
        for ($c = 1; $c -le $columnCount; $c++) {
          $cell = $table.Cell($r, $c); $cellShape = $cell.Shape
          try { $parts.Add((Read-Shape $cellShape ($depth + 1))) } finally { Release-Com $cellShape; Release-Com $cell }
        }
      }
    } elseif ($shape.HasTextFrame -eq -1) {
      $frame = $shape.TextFrame
      if ($frame.HasText -eq -1) { $range = $frame.TextRange; $parts.Add((Check-Text ([string]$range.Text))) }
    }
    return ($parts -join "`n")
  } finally { Release-Com $range; Release-Com $frame; Release-Com $table; Release-Com $groups }
}
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.app -notin @('word','excel','powerpoint') -or -not [IO.Path]::IsPathRooted($request.file)) { throw 'document_office_policy' }
  if ((Get-FileHash -LiteralPath $request.file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $request.expectedHash) { throw 'mail_source_changed' }
  $processName = @{word='WINWORD';excel='EXCEL';powerpoint='POWERPNT'}[$request.app]
  $beforeProcesses = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  try { $app = New-Object -ComObject (@{word='Word.Application';excel='Excel.Application';powerpoint='PowerPoint.Application'}[$request.app]) } catch { throw 'document_office_missing' }
  if ([string]$app.Version -notmatch '^16\.') { throw 'document_office_version' }
  $oldSecurity = $app.AutomationSecurity
  $app.AutomationSecurity = 3 # msoAutomationSecurityForceDisable
  if ($request.app -eq 'word') {
    $collection = $app.Documents
    # ReadOnly=true, no recent-file entry, no revert, repair or password guess.
    $document = $collection.Open($request.file, $false, $true, $false, '', '', $false, '', '', 0, [Type]::Missing, $false, $false, $false)
    if (-not $document.ReadOnly) { throw 'document_office_policy' }
    $content = $document.Content
    try { $segments.Add(@{text=(Check-Text ([string]$content.Text))}) } finally { Release-Com $content }
    $coverage = 'Office Word 본문과 표 텍스트. 머리말, 꼬리말, 이미지와 서식은 미확인'
  } elseif ($request.app -eq 'excel') {
    $oldEvents = $app.EnableEvents; $app.EnableEvents = $false
    $oldAlerts = $app.DisplayAlerts; $app.DisplayAlerts = $false
    $collection = $app.Workbooks
    # UpdateLinks=0, ReadOnly=true; no macro execution or external link refresh.
    $document = $collection.Open($request.file, 0, $true, [Type]::Missing, '', '', $true, [Type]::Missing, [Type]::Missing, $false, $false, [Type]::Missing, $false)
    if (-not $document.ReadOnly) { throw 'document_office_policy' }
    $sheets = $document.Worksheets; $totalCells = 0
    try {
      if ($sheets.Count -gt 200) { throw 'document_limit' }
      for ($i = 1; $i -le $sheets.Count; $i++) {
        $sheet = $sheets.Item($i); $used = $null; $cells = $null; $rows = $null; $columns = $null
        try {
          $used = $sheet.UsedRange; $totalCells += $used.CountLarge
          if ($totalCells -gt 20000) { throw 'document_limit' }
          $rows = $used.Rows; $columns = $used.Columns; $cells = $used.Cells
          $lines = New-Object 'System.Collections.Generic.List[string]'
          for ($r = 1; $r -le $rows.Count; $r++) {
            $values = New-Object 'System.Collections.Generic.List[string]'
            for ($c = 1; $c -le $columns.Count; $c++) {
              $cell = $cells.Item($r, $c)
              try { $values.Add((Check-Text ([string]$cell.Text))) } finally { Release-Com $cell }
            }
            $lines.Add(($values -join "`t"))
          }
          $segments.Add(@{sheet=[string]$sheet.Name;text=($lines -join "`n")})
        } finally { Release-Com $cells; Release-Com $rows; Release-Com $columns; Release-Com $used; Release-Com $sheet }
      }
    } finally { Release-Com $sheets }
    $coverage = 'Office Excel 셀 표시 값. 수식 재계산, 숨겨진 개체와 이미지의 해석은 미확인'
  } else {
    $collection = $app.Presentations
    $document = $collection.Open($request.file, -1, 0, 0)
    if ($document.ReadOnly -ne -1) { throw 'document_office_policy' }
    $slides = $document.Slides
    try {
      if ($slides.Count -gt 200) { throw 'document_limit' }
      for ($i = 1; $i -le $slides.Count; $i++) {
        $slide = $slides.Item($i); $shapes = $slide.Shapes
        try {
          $parts = New-Object 'System.Collections.Generic.List[string]'
          for ($s = 1; $s -le $shapes.Count; $s++) {
            $shape = $shapes.Item($s)
            try { $parts.Add((Read-Shape $shape)) } finally { Release-Com $shape }
          }
          $segments.Add(@{slide=$i;text=($parts -join "`n")})
        } finally { Release-Com $shapes; Release-Com $slide }
      }
    } finally { Release-Com $slides }
    $coverage = 'Office PowerPoint 슬라이드 텍스트와 표. 노트, 이미지와 서식은 미확인'
  }
  if (-not [string]::Equals([IO.Path]::GetFullPath([string]$document.FullName), [IO.Path]::GetFullPath([string]$request.file), [StringComparison]::OrdinalIgnoreCase)) { throw 'document_office_policy' }
  $text = ($segments | ForEach-Object { if ($_.sheet) { "시트: $($_.sheet)`n$($_.text)" } elseif ($_.slide) { "슬라이드 $($_.slide)`n$($_.text)" } else { $_.text }) -join "`n`n"
  if ([string]::IsNullOrWhiteSpace($text)) { throw 'document_empty' }
  if ($text.Length -gt 100000) { throw 'document_limit' }
  if ((Get-FileHash -LiteralPath $request.file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $request.expectedHash) { throw 'mail_source_changed' }
  $reply = @{document=@{text=$text;segments=$segments.ToArray();coverage=$coverage;reader='office_com';officeVersion=[string]$app.Version}}
} catch {
  $known = @('document_limit','document_empty','document_office_missing','document_office_version','document_office_policy','mail_source_changed')
  $message = [string]$_.Exception.Message
  $reply = @{error=$(if ($message -in $known) { $message } else { 'document_office_read_failed' })}
} finally {
  # Close only the document returned by our Open. Never save or enumerate and
  # close a user's files, terminate Office processes or modify Trust Center.
  try { if ($document) { if ($request.app -eq 'word') { $document.Close(0) } elseif ($request.app -eq 'excel') { $document.Close($false) } else { $document.Close() } } } catch { $reply = @{error='document_office_read_failed'} }
  try {
    if ($app -and $null -ne $oldSecurity) { $app.AutomationSecurity = $oldSecurity }
    if ($app -and $null -ne $oldEvents) { $app.EnableEvents = $oldEvents }
    if ($app -and $null -ne $oldAlerts) { $app.DisplayAlerts = $oldAlerts }
    # PowerPoint may reuse a running instance. Quit only when no app existed
    # before launch and the owned instance has no remaining documents.
    if ($app -and $beforeProcesses.Count -eq 0 -and $collection -and $collection.Count -eq 0) { $app.Quit() }
  } catch { $reply = @{error='document_office_read_failed'} }
  Release-Com $document; Release-Com $collection; Release-Com $app
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
[Console]::Out.Write(($reply | ConvertTo-Json -Depth 8 -Compress))
