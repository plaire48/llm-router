import {existsSync,symlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
// Original schema-path tests resolve dependencies from the original repository root.
const link=resolve('vendor/genoffice/node_modules');if(!existsSync(link))symlinkSync(resolve('node_modules'),link,'junction');
for(const pkg of ['pptx-engine','pptx-ops','pipelines','pdf2docx']){const r=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['test','-w','@genoffice/'+pkg,'--','--maxWorkers=4'],{stdio:'inherit',shell:process.platform==='win32'});if(r.status!==0)process.exit(r.status||1);}
