// Installed runtime diagnostic. User/CI supplies a synthetic approved folder;
// this never touches a current Office document or invokes a model.
import {Artifacts} from '../runtime-src/services';
import {markdownSkill} from '../runtime-src/markdown-skill';
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',b=>{input+=b;if(input.length>8192)process.exit(2);});process.stdin.on('end',async()=>{try{
 const request=JSON.parse(input),artifacts=new Artifacts(request.root),row=artifacts.register(request.path,basename(request.path));
 const skill=markdownSkill({native:async()=>{throw Error('unexpected_native_call');},context:{app:'excel'},artifacts,event(){}});
 const result=await skill.executeTool({id:'diagnostic',name:'export_markdown',input:{artifactId:row.id,engine:request.engine||'auto',save:false}}),data=JSON.parse(result.output);if(result.isError){process.stdout.write(JSON.stringify(data)+'\n');process.exitCode=1;return;}
 const output=artifacts.get(data.artifactId).path;const hash=(await import('node:crypto')).createHash('sha256').update(readFileSync(output)).digest('hex');if(hash!==data.sha256)throw Error('markdown_save_unverified');delete data.preview;process.stdout.write(JSON.stringify({...data,output,actualOffice:false})+'\n');
 }catch{process.stdout.write('{"error":"markdown_diagnostic_failed"}\n');process.exitCode=1;}});
