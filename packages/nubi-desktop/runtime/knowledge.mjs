import {createServer} from 'node:http';
import path from 'node:path';
import {realpath,lstat} from 'node:fs/promises';
import {createNubiApi,buildGraph} from '../generated/openwiki.mjs';

export async function connectKnowledge() {
  this.ready(); if(this.knowledge)return {url:this.knowledge.url};
  const wikiRoot=path.join(this.root,'openwiki');
  if(await realpath(wikiRoot)!==wikiRoot || !(await lstat(wikiRoot)).isDirectory())throw new Error('wiki_missing');
  let graph=await buildGraph(wikiRoot);
  const api=await createNubiApi({wikiRoot,projectRoot:this.root,getGraph:()=>graph});
  const page='<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>누비 OpenWiki</title></head><body><main><h1>프로젝트 지식 연결</h1><p>이 탭에서 누비 웹 확장을 열고 프로젝트 연결을 선택하세요.</p><p>Wiki와 소스 읽기만 허용합니다. 수정은 데스크톱에서 검토해 주세요.</p></main></body></html>';
  const server=createServer(async(req,res)=>{
    try {
      if(!api.guard(req,res))return;
      if(req.url?.startsWith('/api/nubi/v1/')){
        if(req.url.startsWith('/api/nubi/v1/wiki/'))graph=await buildGraph(wikiRoot);
        return await api.handle(req,res);
      }
      if(req.url!=='/'||req.method!=='GET'){res.writeHead(404).end();return;}
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"}).end(api.decorateHtml(page));
    }catch{if(!res.headersSent)res.writeHead(500);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url=`http://127.0.0.1:${server.address().port}/`;
  this.knowledge={url,server};return {url};
}
