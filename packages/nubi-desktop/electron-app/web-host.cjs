const {createServer}=require('node:http');
const {readFile,realpath}=require('node:fs/promises');
const path=require('node:path');
const {randomBytes,timingSafeEqual}=require('node:crypto');

// Optional local web surface of the owned Electron host. No mock responses,
// filesystem endpoint, provider tokens, CORS or automatic RPC retries.
async function startWebHost({frontend,dispatch,port=4318}) {
 const root=await realpath(frontend),secret=randomBytes(32).toString('hex');let origin;
 const equal=value=>typeof value==='string'&&value.length===secret.length&&timingSafeEqual(Buffer.from(value),Buffer.from(secret));
 const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};
 const bridge=()=>`(()=>{const capability=${JSON.stringify(secret)};Object.defineProperty(window,'nubi',{value:Object.freeze({request:async(method,args={})=>{const response=await fetch('/nubi/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Nubi-Session':capability},body:JSON.stringify({method,args}),credentials:'same-origin'});if(!response.ok)throw Error('host_disconnected');return response.json();}})});})();`;
 const server=createServer(async(req,res)=>{try{
  if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||['cross-site','same-site'].includes(req.headers['sec-fetch-site'])){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(url.pathname==='/nubi/rpc'){
   if(req.method!=='POST'||!equal(req.headers['x-nubi-session'])||req.headers['content-type']!=='application/json'){res.writeHead(403).end();return;}
   let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>4*1024*1024){res.writeHead(413).end();return;}parts.push(chunk);}
   let message;try{message=JSON.parse(Buffer.concat(parts).toString());}catch{res.writeHead(400).end();return;}
   if(typeof message?.method!=='string'||!message.args||typeof message.args!=='object'||Array.isArray(message.args)){res.writeHead(400).end();return;}
   const result=await dispatch(message.method,message.args);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(result??null));return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  if(url.pathname==='/host-bridge.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(req.method==='HEAD'?undefined:bridge());return;}
  const file=await realpath(path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname))),rel=path.relative(root,file);if(!rel||rel.startsWith('..')||path.isAbsolute(rel)){res.writeHead(403).end();return;}
  // The renderer URL includes a build hash. Inject the bridge independently of
  // that URL so refreshing a new build still connects to the owned host.
  // A page without a head (a fixture, a stripped build) still gets the bridge: before the body's first child, else first.
  let data=await readFile(file);if(file.endsWith('/index.html')){const text=data.toString(),tag='<script src="/host-bridge.js"></script>';data=text.includes('</head>')?text.replace('</head>',tag+'</head>'):/<body[^>]*>/i.test(text)?text.replace(/<body[^>]*>/i,open=>open+tag):tag+text;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'}).end(req.method==='HEAD'?undefined:data);
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
 return {origin,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
module.exports={startWebHost};
