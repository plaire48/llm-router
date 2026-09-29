import test from 'node:test';
import assert from 'node:assert/strict';
import {mcpConfig,mcpPermission,mcpSummary} from '../mcp-config.js';
import {connectMcp,mcpFetch,mcpCallBinding,callMcp} from '../mcp-client.js';
const config={name:'Local tools',url:'http://127.0.0.1:3333/mcp',headers:[{name:'Authorization',value:'Bearer private-test-secret'},{name:'X-Workspace',value:'test-workspace'}]};
const tools=[{name:'read_note',description:'Read a note',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}}];
function fixture({toolList=tools,failCall=false}={}) {
  const calls=[];
  const fetchImpl=async (url,init) => {
    assert.equal(url,config.url);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
    assert.equal(init.headers.get('authorization'),'Bearer private-test-secret');
    if (init.method === 'GET') return new Response(null,{status:405});
    const message=JSON.parse(init.body);calls.push(message);
    if (!('id' in message)) return new Response(null,{status:202});
    if (message.method === 'tools/call' && failCall) throw new Error('Could include private-test-secret upstream');
    const result=message.method === 'initialize' ? {protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}} : message.method === 'tools/list' ? {tools:toolList} : {content:[{type:'text',text:'Note: Bearer private-test-secret'}]};
    return new Response(JSON.stringify({jsonrpc:'2.0',id:message.id,result}),{headers:{'content-type':'application/json'}});
  };
  return {calls,options:{fetchImpl,permission:async () => true}};
}
test('HTTP and HTTPS accept explicit auth headers and reject injection, ambient cookies and protocol overrides', () => {
  assert.equal(mcpConfig(config).url,config.url);
  assert.equal(mcpConfig({...config,url:'https://example.com/mcp'}).url,'https://example.com/mcp');
  assert.equal(mcpPermission(config.url),'http://127.0.0.1/*');
  for (const url of ['file:///a','https://a:b@example.com','https://example.com/mcp?token=foo','https://example.com/#a']) assert.throws(() => mcpConfig({...config,url}),/mcp_address/);
  for (const name of ['Cookie','Origin','Host','Content-Type','Sec-Fetch-Site','Mcp-Session-Id','Proxy-Authorization']) assert.throws(() => mcpConfig({...config,headers:[{name,value:'x'}]}),/mcp_headers/);
  assert.throws(() => mcpConfig({...config,headers:[{name:'Authorization',value:'foo\r\nInjected: yep'}]}),/mcp_headers/);
  assert.throws(() => mcpConfig({...config,headers:[{name:'X-Test',value:'one'},{name:'x-test',value:'two'}]}),/mcp_headers/);
});
test('SDK initializes, lists and pins tools without exposing credentials in public summaries', async () => {
  const f=fixture(),record=await connectMcp(config,f.options);
  assert.equal(record.tools.length,1);
  assert(!JSON.stringify(mcpSummary(record)).includes('private-test-secret'));
  assert.equal(f.calls.filter(c => c.method === 'tools/call').length,0);
  const bound=mcpCallBinding([record],[{id:record.id,hash:record.hash}],{server_id:record.id,tool:'read_note',arguments:{id:'123'}});
  assert.equal(bound.kind,'mcp');
  const result=await callMcp(record,bound,f.options);
  assert.equal(result.ok,true);assert.equal(result.actionIssued,true);
  assert(!JSON.stringify(result).includes('private-test-secret'));
  assert.equal(f.calls.filter(c => c.method === 'tools/call').length,1);
  assert.throws(() => mcpCallBinding([record],[{id:record.id,hash:record.hash}],{server_id:record.id,tool:'read_note',arguments:{id:3}}),/mcp_arguments/);
});
test('schema changes, revoked permission and expired approvals never dispatch a call', async () => {
  const f=fixture(),record=await connectMcp(config,f.options);
  const bound=mcpCallBinding([record],[{id:record.id,hash:record.hash}],{server_id:record.id,tool:'read_note',arguments:{id:'123'}});
  const changed=fixture({toolList:[{...tools[0],description:'NEW DEFINITION'}]});
  assert.equal((await callMcp(record,bound,changed.options)).error,'mcp_changed');
  assert.equal(changed.calls.filter(c => c.method === 'tools/call').length,0);
  assert.equal((await callMcp(record,{...bound,expiresAt:1},f.options)).actionIssued,false);
  assert.equal((await callMcp(record,bound,{...f.options,permission:async () => false})).actionIssued,false);
});
test('lost call receipt is uncertain and never retried; endpoint redirects and oversized payloads rejected', async () => {
  const f=fixture(),record=await connectMcp(config,f.options);
  const bound=mcpCallBinding([record],[{id:record.id,hash:record.hash}],{server_id:record.id,tool:'read_note',arguments:{id:'123'}});
  const failure=fixture({failCall:true});
  const result=await callMcp(record,bound,failure.options);
  assert.equal(result.error,'mcp_unknown');assert.equal(result.actionIssued,true);
  assert.equal(failure.calls.filter(c => c.method === 'tools/call').length,1);
  assert(!JSON.stringify(result).includes('private-test-secret'));
  await assert.rejects(mcpFetch(config,new AbortController().signal)('https://another.example/mcp'),/mcp_address/);
  await assert.rejects(mcpFetch(config,new AbortController().signal,async () => new Response(null,{status:302}))(config.url),/mcp_connect/);
  await assert.rejects(mcpFetch(config,new AbortController().signal,async () => new Response('x',{headers:{'content-length':'2000000'}}))(config.url),/mcp_response/);
});
