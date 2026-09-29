// Keeps ONE model login alive for repeated evaluation runs, so a source change
// does not require a new login. Run this first, log in once in the browser,
// then start eval/run.mjs from another terminal. Evaluation-only.
import {createProviders} from '../../nubi-office/worker/providers.mjs';
import {startRelayServer,defaultSocketPath} from './relay.mjs';

const option=name=>{const index=process.argv.indexOf('--'+name);return index>0?process.argv[index+1]:undefined;};
const provider=option('provider')||'chatgpt',model=option('model')||'gpt-5.6-luna',socketPath=option('socket')||defaultSocketPath();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(!['chatgpt','aipro'].includes(provider)){console.error('이 세션은 브라우저 로그인 제공자(chatgpt, aipro)만 지원합니다.');process.exit(2);}
const providers=createProviders({hostLabel:'누비 워크스페이스 평가'});
console.log('브라우저에서 로그인해 주세요. 3분 안에 완료해야 합니다.');
await providers.login(provider);
while(providers.status().pending)await pause(200);
if(!providers.status().connected){console.error('로그인을 완료하지 못했습니다: '+(providers.status().loginError||'no_credential'));providers.dispose();process.exit(1);}
try{providers.model(model);}catch{console.error('이 계정의 모델 목록에 없는 모델입니다: '+model);providers.dispose();process.exit(1);}
const server=await startRelayServer({providers,socketPath});
const stop=async()=>{await server.close();providers.dispose();process.exit(0);};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
console.log('READY '+JSON.stringify({provider,model,socket:socketPath}));
