import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
const root=await realpath('electron-app/lib/frontend'),bridgePath=path.resolve('preview/bridge.js'),port=Number(process.env.NUBI_PREVIEW_PORT||4320);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};
const server=createServer(async(req,res)=>{try{
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/preview-bridge.js'){const bridge=await readFile(bridgePath);res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(req.method==='HEAD'?undefined:bridge);return;}
 const file=await realpath(path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname))));const rel=path.relative(root,file);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error();
 let data=await readFile(file);
 if(file.endsWith('/index.html'))data=data.toString().replace('<body>','<body><div class="preview-strip"><span>화면 미리보기 / 예시 데이터</span><nav aria-label="미리보기 화면"><a href="/?login">로그인</a><a href="/">시작</a><a href="/?conversation">대화</a></nav></div>').replace('<script type="module"','<script src="/preview-bridge.js"></script><script type="module"').replace('</head>','<style>.preview-strip{height:32px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;padding:0 18px;font:12px Pretendard,sans-serif;background:#fff;color:#4E5968;border-bottom:1px solid #E5E8EB}.preview-strip nav{display:flex;gap:16px}.preview-strip a{color:#1B64DA;text-decoration:none}#root{height:calc(100vh - 32px)!important;min-height:0!important}.nubi-workbench[data-host-layout=integrated]{height:100%;min-height:100%}.nubi-workbench[data-host-layout=integrated] .nubi-sidebar{height:100%;min-height:100%}</style></head>');
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404).end();}});
server.listen(port,'127.0.0.1',()=>console.log(`Nubi visual preview: http://127.0.0.1:${port}/?login`));
