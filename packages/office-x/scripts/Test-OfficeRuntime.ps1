# Run on a Windows PC with Office installed. Creates disposable unsaved test documents.
param([string]$InstallRoot="$env:ProgramFiles\Nubi Office X",[string]$OutputPath="$env:TEMP\nubi-office-runtime.json")
$ErrorActionPreference='Stop'
[void][Reflection.Assembly]::LoadFrom((Join-Path $InstallRoot 'Newtonsoft.Json.dll'))
[void][Reflection.Assembly]::LoadFrom((Join-Path $InstallRoot 'OfficeX.Core.dll'))
$hostAssembly=[Reflection.Assembly]::LoadFrom((Join-Path $InstallRoot 'OfficeX.ExcelHost.dll'))
$portType=$hostAssembly.GetType('OfficeX.ExcelHost.OfficeAutomationPort',$true)
$results=@()
$originalCulture=[Threading.Thread]::CurrentThread.CurrentCulture
[Threading.Thread]::CurrentThread.CurrentCulture=[Globalization.CultureInfo]::GetCultureInfo('en-US')
function Read-Steps([string]$json){return ,([Newtonsoft.Json.JsonConvert]::DeserializeObject($json,[Collections.Generic.List[OfficeX.Core.OfficeStep]]))}
foreach($kind in @('word','excel','powerpoint')){
 $application=$null;$document=$null;$port=$null
 try {
  $progId=@{word='Word.Application';excel='Excel.Application';powerpoint='PowerPoint.Application'}[$kind]
  $application=New-Object -ComObject $progId
  if($kind -eq 'powerpoint'){$application.Visible=-1;$document=$application.Presentations.Add(-1)}
  elseif($kind -eq 'word'){$application.Visible=$true;$document=$application.Documents.Add()}
  else{$application.Visible=$true;$document=$application.Workbooks.Add(-4167)}
  $hwnd=[int]$application.ActiveWindow.HWND
  $port=[Activator]::CreateInstance($portType,@($application,$kind,$hwnd))
  $session=[OfficeX.Core.OfficeAutomationSession]::new($port)
  if($kind -eq 'word'){
   $read='[{"id":"body","target":"document","action":"get","member":"Content"},{"target":"body","action":"get","member":"Text"}]'
   $write='[{"target":"body","action":"set","member":"Text","value":"Native Word check\r"}]'
   $checks='[{"read":{"target":"body","action":"get","member":"Text"},"equals":"Native Word check\r"}]'
  }elseif($kind -eq 'excel'){
   $read='[{"id":"sheets","target":"document","action":"get","member":"Worksheets"},{"id":"sheet","target":"sheets","action":"get","member":"Item","args":[1]},{"id":"range","target":"sheet","action":"get","member":"Range","args":["A1:B2"]},{"target":"range","action":"get","member":"Value2"}]'
   $write='[{"target":"range","action":"set","member":"Value2","value":[["Item","Value"],["Test",1200]]}]'
   $checks='[{"read":{"target":"range","action":"get","member":"Value2"},"equals":[["Item","Value"],["Test",1200]]}]'
  }else{
   $read='[{"id":"slides","target":"document","action":"get","member":"Slides"},{"target":"slides","action":"get","member":"Count"}]'
   $write='[{"id":"slide","target":"slides","action":"call","member":"Add","args":[1,12]},{"id":"shapes","target":"slide","action":"get","member":"Shapes"},{"id":"box","target":"shapes","action":"call","member":"AddTextbox","args":[1,40,40,500,100]},{"id":"frame","target":"box","action":"get","member":"TextFrame"},{"id":"text","target":"frame","action":"get","member":"TextRange"},{"target":"text","action":"set","member":"Text","value":"Native PowerPoint check"}]'
   $checks='[{"read":{"target":"text","action":"get","member":"Text"},"equals":"Native PowerPoint check"},{"read":{"target":"slides","action":"get","member":"Count"},"equals":1}]'
  }
  $snapshot=$session.Inspect((Read-Steps $read))
  $checkList=[Newtonsoft.Json.JsonConvert]::DeserializeObject($checks,[Collections.Generic.List[OfficeX.Core.OfficeCheck]])
  $plan=$session.Prepare($snapshot.SnapshotId,'Disposable native Office verification',(Read-Steps $write),$checkList)
  $receipt=$session.Apply($plan.Id,$true,[Threading.CancellationToken]::None)
  if($receipt.Status -ne 'verified'){throw ([OfficeX.Core.Wire]::Json($receipt))}
  $features=[OfficeX.ExcelHost.OfficeRuntimeDiagnostics]::CheckFeatures($application,$kind,$hwnd)
  $results+=@{app=$kind;passed=$true;features=([OfficeX.Core.Wire]::Json($features)|ConvertFrom-Json);receipt=([OfficeX.Core.Wire]::Json($receipt)|ConvertFrom-Json)}
 }catch{$results+=@{app=$kind;passed=$false;error=$_.Exception.Message}}
 finally{
  if($port){$port.Dispose()}
  if($document){try{if($kind -eq 'powerpoint'){$document.Saved=-1;$document.Close()}else{$document.Close($false)}}catch{};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($document)}
  if($application){try{$remaining=if($kind -eq 'powerpoint'){$application.Presentations.Count}elseif($kind -eq 'word'){$application.Documents.Count}else{$application.Workbooks.Count};if($remaining -eq 0){$application.Quit()}}catch{};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($application)}
 }
}
[Threading.Thread]::CurrentThread.CurrentCulture=$originalCulture
$record=@{version='0.8.11';scope='live Office COM through the installed host; not VSTO pane or live LLM';passed=(@($results|Where-Object {!$_.passed}).Count -eq 0);results=$results}
$record|ConvertTo-Json -Depth 20|Set-Content $OutputPath -Encoding UTF8
$record|ConvertTo-Json -Depth 20
if(!$record.passed){exit 1}
