import {runTests,downloadAndUnzipVSCode,resolveCliArgsFromVSCodeExecutablePath} from '@vscode/test-electron';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const debugPort=server.address().port;await new Promise(r=>server.close(r));
await mkdir('verification',{recursive:true});
const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-vscode-test-')),root=path.join(temp,'project');await mkdir(path.join(root,'openwiki'),{recursive:true});
await writeFile(path.join(root,'app.txt'),'before\n');await writeFile(path.join(root,'openwiki/overview.md'),'# Project identity\n\nNubi source fixture.');
for(const args of [['init','-b','main'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']])if(spawnSync('git',args,{cwd:root}).status!==0)throw Error('fixture_git_failed');
try{
  const executable=process.env.NUBI_TEST_VSCODE||await downloadAndUnzipVSCode('stable');
  const profile=['--user-data-dir='+path.join(temp,'vscode'),'--extensions-dir='+path.join(temp,'extensions')];
  let development=process.cwd();
  if(process.env.NUBI_TEST_VSIX){
    const [cli,...args]=resolveCliArgsFromVSCodeExecutablePath(executable,{reuseMachineInstall:true});
    const installed=spawnSync(cli,[...args,...profile,'--install-extension',path.resolve(process.env.NUBI_TEST_VSIX),'--force'],{stdio:'inherit',shell:process.platform==='win32'});
    if(installed.status!==0)throw Error('vsix_install_failed');
    development=path.join(temp,'test-driver');await mkdir(development);
    await writeFile(path.join(development,'package.json'),JSON.stringify({name:'nubi-verification-driver',publisher:'nubi-test',version:'0.0.0',engines:{vscode:'^1.100.0'}}));
  }
  await runTests({vscodeExecutablePath:executable,extensionDevelopmentPath:development,extensionTestsEnv:{NUBI_TEST_CDP_PORT:String(debugPort),NUBI_TEST_INSTALLED:process.env.NUBI_TEST_VSIX?'1':'0'},extensionTestsPath:path.resolve('tests/vscode-suite.cjs'),launchArgs:[root,'--remote-debugging-port='+debugPort,...(process.env.NUBI_TEST_VSIX?[]:['--disable-extensions']),'--disable-workspace-trust','--skip-welcome','--skip-release-notes',...profile]});
}finally{await rm(temp,{recursive:true,force:true});}
