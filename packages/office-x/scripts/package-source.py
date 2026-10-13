"""Create a source-only Windows handoff. Never include local state or binaries."""
from pathlib import Path
import os,json,zipfile,hashlib
root=Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text())['version']
out=root/'artifacts'/f'office-x-{version}-source.zip';out.parent.mkdir(exist_ok=True)
excluded={'node_modules','bin','obj','.git','.vs','.playwright-mcp','__pycache__','artifacts','releases','packages','target','workspace'}
files=[]
for directory,dirs,names in os.walk(root):
 dirs[:]=[d for d in dirs if (d not in excluded or (d=='bin' and 'vendor/genoffice' in str(Path(directory).relative_to(root))) or (d=='packages' and Path(directory).name in ['genoffice','nubi'])) and not (Path(directory)==root and d in ['runtime','.codex','.agents']) and not (Path(directory)==root/'installer' and d in ['stage','runtime','prerequisites','node-x64','node-x86','companion'])]
 for name in sorted(names):
  p=Path(directory)/name
  if (p.parent==root/'installer' and p.suffix=='.zip') or name=='.DS_Store' or name.startswith('.env') or p.suffix.lower() in ['.pfx','.p12','.user','.pyc']:continue
  files.append(p)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
 for p in sorted(files):archive.write(p,Path('office-x')/p.relative_to(root))
with zipfile.ZipFile(out) as archive:
 assert archive.testzip() is None
 for path in ['vendor/nubi/packages/nubi-desktop/runtime/desktop-providers.mjs','runtime-src/nubi-wire.mjs','dist/ui/index.html','dist/worker/main.cjs','scripts/Build-Windows.ps1']:
  assert 'office-x/'+path in archive.namelist()
record={'artifact':out.name,'files':len(files),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'kind':'source; not a Windows installer'}
out.with_suffix('.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
