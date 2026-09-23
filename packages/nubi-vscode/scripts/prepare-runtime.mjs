import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,copyFile,cp,chmod,rm,mkdtemp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
// Build-time only: users never install Node or download an executable at activation.
const version='24.18.0',platform=process.platform,arch=process.arch;
if(!['win32','darwin','linux'].includes(platform)||!['x64','arm64'].includes(arch))throw Error('unsupported_target');
const stem=`node-v${version}-${platform==='win32'?'win':platform}-${arch}`,file=stem+(platform==='win32'?'.zip':'.tar.gz'),url=`https://nodejs.org/dist/v${version}/`;
const get=async name=>{const response=await fetch(url+name,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('node_download_failed');return Buffer.from(await response.arrayBuffer());};
const sums=(await get('SHASUMS256.txt')).toString(),expected=sums.split('\n').find(line=>line.endsWith('  '+file))?.split(' ')[0];
if(!/^[a-f0-9]{64}$/.test(expected||''))throw Error('node_checksum_missing');
const archive=await get(file);if(createHash('sha256').update(archive).digest('hex')!==expected)throw Error('node_checksum_mismatch');
const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-vscode-node-'));
try{
  await writeFile(path.join(temp,file),archive);
  const result=platform==='win32'?spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath $env:NUBI_ARCHIVE -DestinationPath $env:NUBI_EXTRACT'],{env:{...process.env,NUBI_ARCHIVE:path.join(temp,file),NUBI_EXTRACT:temp},stdio:'inherit'}):spawnSync('tar',['-xzf',path.join(temp,file),'-C',temp],{stdio:'inherit'});
  if(result.status!==0)throw Error('node_extract_failed');await mkdir('runtime',{recursive:true});
  const binary=platform==='win32'?'node.exe':'node';await copyFile(path.join(temp,stem,platform==='win32'?'node.exe':'bin/node'),path.join('runtime',binary));await chmod(path.join('runtime',binary),0o755);
  await copyFile(path.join(temp,stem,'LICENSE'),'licenses/Node-LICENSE');
  await writeFile('runtime/manifest.json',JSON.stringify({version,platform,arch,archiveSha256:expected,sha256:createHash('sha256').update(await readFile(path.join('runtime',binary))).digest('hex')},null,2));
  if(platform==='win32')await cp('../nubi-desktop/generated/winapp','runtime/winapp',{recursive:true});
  console.log(`Bundled Node ${version} verified for ${platform}-${arch}.`);
}finally{await rm(temp,{recursive:true,force:true});}
