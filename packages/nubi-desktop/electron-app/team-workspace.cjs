const {createServer}=require('node:http');
const {createHash,randomBytes,timingSafeEqual}=require('node:crypto');

const GHES='https://code.sdsdev.co.kr',REPO='/api/v3/repos/Manufacturing-IT/ai_workspace';
const SHA=/^[a-f0-9]{40}$/,MAX=24*1024*1024;
const MIME={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json',svg:'image/svg+xml',png:'image/png',webp:'image/webp',gif:'image/gif',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',txt:'text/plain; charset=utf-8'};
const failure=(code,status=503)=>Object.assign(Error(code),{status});
const cleanPath=value=>typeof value==='string'&&value.length<1600&&!/[\\\x00-\x1f]/.test(value)&&!value.split('/').some(part=>!part||part==='.'||part==='..');
const writablePath=value=>cleanPath(value)&&(/^data\/[\w./-]+\.json$/.test(value)||['.agents/plugins/marketplace.json','.claude-plugin/marketplace.json'].includes(value)||/^plugins\/[a-z0-9]+(?:-[a-z0-9]+)*\/[\w./-]+$/.test(value));
async function bytes(response,max=MAX){let size=0,parts=[];if(!response.body)return Buffer.alloc(0);for await(const part of response.body){size+=part.length;if(size>max)throw failure('team_workspace_limit',413);parts.push(Buffer.from(part));}return Buffer.concat(parts);}

// This compatibility layer supplies an opaque session marker to the existing
// static app. The real GHES credential never enters HTML, storage or the frame.
function bridge({key,profile,prefix}){
  const identity={id:profile.id,login:profile.login,name:profile.name,avatar_url:profile.avatar||''};
  return `(()=>{const key=${JSON.stringify(key)},prefix=${JSON.stringify(prefix)},nativeFetch=window.fetch.bind(window);
    for(const [name,value] of Object.entries({gh_token:'nubi-desktop-session',gh_host:'code.sdsdev.co.kr',gh_owner:'Manufacturing-IT',gh_repo:'ai_workspace',gh_user:JSON.stringify(${JSON.stringify(identity)})}))localStorage.setItem(name,value);
    window.fetch=async(input,init)=>{
      const request=new Request(typeof input==='string'?new URL(input,location.href).href:input,init),url=new URL(request.url);
      if(url.origin===${JSON.stringify(GHES)}&&url.pathname.startsWith('/api/v3/')){
        const payload={url:url.href,method:request.method,accept:request.headers.get('Accept')||'application/vnd.github+json',body:['GET','HEAD'].includes(request.method)?null:await request.text()};
        const reply=await nativeFetch(prefix+'__workspace/api',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Nubi-Workspace':key},body:JSON.stringify(payload),signal:request.signal});
        const value=await reply.json(),status=value.status||reply.status;return new Response([204,205,304].includes(status)?null:value.body||'',{status,headers:value.headers||{'Content-Type':'application/json'}});
      }
      return nativeFetch(request);
    };
  })();`;
}

// Read build assets at one Git revision. Data queries stay live and the web
// app's immutable snapshot/head transaction remains the only storage model.
async function startTeamWorkspace({account,confirmSave=async()=>false}){
  const credential=await account.credential(),generation=credential.generation,key=randomBytes(32).toString('hex'),prefix='/w/'+key+'/';let closed=false;
  const active=()=>{if(closed||account.generation!==generation||account.state!=='connected'||account.record?.token!==credential.token||account.record.expiresAt&&account.record.expiresAt<=account.now())throw failure('ghes_session_changed',401);};
  const read=async route=>{active();const result=await account.request(route,{token:credential.token,limit:MAX});active();return result;};
  const ref=await read(REPO+'/git/ref/heads/main'),revision=ref.object?.sha;
  if(!SHA.test(revision||''))throw failure('team_workspace_invalid');
  const commit=await read(REPO+'/git/commits/'+revision),tree=await read(REPO+'/git/trees/'+commit.tree?.sha+'?recursive=1');
  if(tree.truncated||!Array.isArray(tree.tree)||tree.tree.length>30000)throw failure('team_workspace_limit');
  const files=new Map(tree.tree.filter(file=>file.type==='blob'&&['100644','100755'].includes(file.mode)&&SHA.test(file.sha||'')).map(file=>[file.path,file]));
  if(!files.has('index.html'))throw failure('team_workspace_ui_missing',404);
  const cache=new Map(),blobs=new Set(),trees=new Map(),commits=new Map(),published=new Set(),sourceTrees=new Map([[commit.tree.sha,new Set([revision])]]);let cacheSize=0,origin,publishing=false;
  const asset=async pathname=>{
    if(!cleanPath(pathname)||!(/^(?:assets|icons|fonts)\//.test(pathname)||['index.html','favicon.svg','workspace-runner.html'].includes(pathname)||/^data\/[\w./-]+\.json$/.test(pathname)))throw failure('team_workspace_file_missing',404);
    const entry=files.get(pathname);if(!entry||entry.size>MAX)throw failure('team_workspace_file_missing',404);
    if(cache.has(entry.sha))return cache.get(entry.sha);
    const value=await read(REPO+'/git/blobs/'+entry.sha);
    if(value.encoding!=='base64'||typeof value.content!=='string')throw failure('team_workspace_invalid');
    const content=Buffer.from(value.content.replace(/\s/g,''),'base64');
    if(content.length!==entry.size||createHash('sha1').update(Buffer.from('blob '+content.length+'\0')).update(content).digest('hex')!==entry.sha)throw failure('team_workspace_changed');
    while(cacheSize+content.length>48*1024*1024&&cache.size){const [sha,old]=cache.entries().next().value;cache.delete(sha);cacheSize-=old.length;}
    cache.set(entry.sha,content);cacheSize+=content.length;return content;
  };
  // Fail before showing a frame if the repository lacks a deployed build.
  await asset('index.html');
  const api=async message=>{
    active();let url;try{url=new URL(message.url);}catch{throw failure('team_workspace_scope',403);}
    if(url.origin!==GHES||url.username||url.password||url.hash||url.href.length>5000)throw failure('team_workspace_scope',403);
    const method=message.method||'GET',route=url.pathname,path=route.startsWith(REPO)?route.slice(REPO.length):null;
    let body;try{body=message.body?JSON.parse(message.body):null;}catch{throw failure('team_workspace_invalid',400);}
    if(!['GET','POST','PATCH'].includes(method))throw failure('team_workspace_scope',403);
    const readable=route==='/api/v3/user'||/^\/api\/v3\/user\/\d+$/.test(route)||/^\/api\/v3\/users\/[a-z\d-]+$/i.test(route)||route==='/api/v3/search/users'||/^\/api\/v3\/orgs\/Manufacturing-IT\/(?:members(?:\/[a-z\d-]+)?|teams(?:\/[a-z\d-]+(?:\/members(?:\/[a-z\d-]+)?|\/memberships\/[a-z\d-]+)?)?)$/i.test(route)||path!==null&&(path===''||/^\/(?:contents\/|git\/(?:ref\/heads\/|refs\/heads\/|commits\/|trees\/|blobs\/)|commits(?:\/|$)|compare\/|branches(?:\/|$)|collaborators(?:\/|$)|assignees(?:\/|$))/.test(path));
    if(method==='GET'&&!readable)throw failure('team_workspace_scope',403);
    if(method!=='GET'){
      if(path==='/git/blobs'&&method==='POST'){
        if(!['utf-8','base64'].includes(body?.encoding)||typeof body.content!=='string'||Object.keys(body).some(k=>!['encoding','content'].includes(k)))throw failure('team_workspace_scope',403);
      }else if(path==='/git/trees'&&method==='POST'){
        if(trees.size>2000||!SHA.test(body?.base_tree||'')||!Array.isArray(body.tree)||!body.tree.length||body.tree.length>3000||body.tree.some(item=>!item||!writablePath(item.path)||!['100644','100755'].includes(item.mode)||item.type!=='blob'||item.sha!==null&&!blobs.has(item.sha)||Object.keys(item).some(k=>!['path','mode','type','sha'].includes(k)))||new Set(body.tree.map(item=>item.path)).size!==body.tree.length||Object.keys(body).some(k=>!['base_tree','tree'].includes(k)))throw failure('team_workspace_scope',403);
      }else if(path==='/git/commits'&&method==='POST'){
        if(commits.size>2000||!trees.has(body?.tree)||!Array.isArray(body.parents)||body.parents.length!==1||!SHA.test(body.parents[0]||'')||typeof body.message!=='string'||!body.message.trim()||body.message.length>3000||Object.keys(body).some(k=>!['tree','parents','message'].includes(k)))throw failure('team_workspace_scope',403);
        const proposedTree=trees.get(body.tree),parent=body.parents[0],createdParent=commits.get(parent);
        // A different base tree could silently replace files not named by the
        // change list. The tree must derive from this exact parent revision.
        if(createdParent?createdParent.tree!==proposedTree.base:!sourceTrees.get(proposedTree.base)?.has(parent))throw failure('team_workspace_scope',403);
      }else if(path==='/git/refs/heads/main'&&method==='PATCH'){
        if(body?.force!==false||!commits.has(body.sha)||Object.keys(body).some(k=>!['sha','force'].includes(k)))throw failure('team_workspace_scope',403);
        if(publishing)throw failure('team_workspace_busy',409);
        publishing=true;
        try{
          const proposed=commits.get(body.sha),head=(await read(REPO+'/git/ref/heads/main')).object?.sha;
          if(head!==proposed.baseHead)throw failure('team_workspace_changed',409);
          if(!await confirmSave({...proposed,sha:body.sha,repository:'Manufacturing-IT/ai_workspace',branch:'main'}))throw failure('team_workspace_save_cancelled',499);
          active();if((await read(REPO+'/git/ref/heads/main')).object?.sha!==head)throw failure('team_workspace_changed',409);
          return await send();
        }finally{publishing=false;}
      }else throw failure('team_workspace_scope',403);
    }
    return send();
    async function send(){
      active();let response;
      try{response=await account.fetcher(url.href,{method,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.any([account.accessController.signal,AbortSignal.timeout(30000)]),headers:{Accept:['application/vnd.github+json','application/vnd.github.object+json'].includes(message.accept)?message.accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+credential.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
      catch{throw failure('team_workspace_network');}
      const raw=(await bytes(response)).toString('utf8');active();
      if(response.status===401){await account.invalidate('ghes_session_expired');throw failure('ghes_session_changed',401);}
      if(response.ok&&(method==='GET'&&['/git/ref/heads/main','/git/refs/heads/main'].includes(path)||method==='PATCH')){
        let result;try{result=JSON.parse(raw);}catch{throw failure('team_workspace_invalid');}
        if(commits.has(result.object?.sha))published.add(result.object.sha);
      }
      if(response.ok&&method==='GET'&&/^\/git\/commits\/[a-f0-9]{40}$/.test(path||'')){
        let result;try{result=JSON.parse(raw);}catch{throw failure('team_workspace_invalid');}
        if(result.sha!==path.split('/').at(-1)||!SHA.test(result.tree?.sha||''))throw failure('team_workspace_invalid');
        if(sourceTrees.size>4000)throw failure('team_workspace_limit');
        if(!sourceTrees.has(result.tree.sha))sourceTrees.set(result.tree.sha,new Set());sourceTrees.get(result.tree.sha).add(result.sha);
      }
      if(response.ok&&method==='POST'){
        let result;try{result=JSON.parse(raw);}catch{throw failure('team_workspace_invalid');}
        if(!SHA.test(result.sha||''))throw failure('team_workspace_invalid');
        if(path==='/git/blobs'){if(blobs.size>10000)throw failure('team_workspace_limit');blobs.add(result.sha);}
        if(path==='/git/trees')trees.set(result.sha,{base:body.base_tree,files:body.tree.map(item=>item.path)});
        if(path==='/git/commits'){
          const parent=commits.get(body.parents[0]),pendingParent=parent&&!published.has(body.parents[0]);
          commits.set(result.sha,{parent:body.parents[0],baseHead:pendingParent?parent.baseHead:body.parents[0],tree:body.tree,files:[...new Set([...(pendingParent?parent.files:[]),...trees.get(body.tree).files])],message:(pendingParent?parent.message+'\n'+body.message:body.message).slice(0,6000)});
        }
      }
      const headers={'Content-Type':'application/json'};
      for(const name of ['x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset','retry-after','link','x-github-request-id']){const value=response.headers.get(name);if(value)headers[name]=value;}
      return {status:response.status,body:raw,headers};
    }
  };
  const server=createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'};
    try{
      active();if(closed||req.headers.host!==new URL(origin).host)throw failure('team_workspace_scope',403);
      const url=new URL(req.url,origin);if(!url.pathname.startsWith(prefix))throw failure('team_workspace_scope',403);
      const rel=decodeURIComponent(url.pathname.slice(prefix.length));
      if(rel==='__workspace/api'){
        const supplied=req.headers['x-nubi-workspace'];
        if(req.method!=='POST'||req.headers.origin!==origin||req.headers['content-type']!=='application/json'||typeof supplied!=='string'||supplied.length!==key.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(key)))throw failure('team_workspace_scope',403);
        let size=0,parts=[];for await(const part of req){size+=part.length;if(size>MAX)throw failure('team_workspace_limit',413);parts.push(part);}
        let message;try{message=JSON.parse(Buffer.concat(parts).toString());}catch{throw failure('team_workspace_invalid',400);}
        const result=await api(message);res.writeHead(200,{...headers,'Content-Type':'application/json'}).end(JSON.stringify(result));return;
      }
      if(!['GET','HEAD'].includes(req.method))throw failure('team_workspace_scope',403);
      if(rel==='__workspace/bridge.js'){res.writeHead(200,{...headers,'Content-Type':'text/javascript'}).end(req.method==='HEAD'?undefined:bridge({key,profile:account.profile,prefix}));return;}
      let content=await asset(rel||'index.html');
      if((rel||'index.html')==='index.html'){
        content=content.toString('utf8');if(!/<head(?:\s[^>]*)?>/i.test(content))throw failure('team_workspace_invalid');
        content=content.replace(/<head(?:\s[^>]*)?>/i,head=>`${head}<script src="${prefix}__workspace/bridge.js"></script>`);
        headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://code.sdsdev.co.kr; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'";
      }
      res.writeHead(200,{...headers,'Content-Type':MIME[rel.split('.').at(-1)]||'application/octet-stream'}).end(req.method==='HEAD'?undefined:content);
    }catch(error){
      if(!res.headersSent)res.writeHead(error.status||503,{...headers,'Content-Type':'application/json'});
      res.end(JSON.stringify({status:error.status||503,body:JSON.stringify({message:error.message.startsWith('team_workspace_')||error.message==='ghes_session_changed'?error.message:'team_workspace_network'}),headers:{'Content-Type':'application/json'}}));
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;
  try{active();}catch(error){server.close();server.closeAllConnections();throw error;}
  return {url:origin+prefix+'index.html#workspace',revision,repository:'Manufacturing-IT/ai_workspace',generation,close:()=>{closed=true;cache.clear();blobs.clear();trees.clear();commits.clear();published.clear();sourceTrees.clear();server.close();server.closeAllConnections();}};
}
module.exports={startTeamWorkspace,writablePath};
