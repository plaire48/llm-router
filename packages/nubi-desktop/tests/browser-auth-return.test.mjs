import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),module={exports:{}};
vm.runInNewContext(await readFile(new URL('../electron-app/browser-host.cjs',import.meta.url),'utf8'),{module,require:name=>name==='electron'?{}:require(name)});
const {BrowserHost}=module.exports;
function fixture(rows,active){
 const events=[],host=Object.create(BrowserHost.prototype);
 Object.assign(host,{tabs:new Map(rows.map(row=>[row.id,row])),active,disposed:false,window:{isDestroyed:()=>false,contentView:{removeChildView(){}}},layout(){},publish(type,detail){events.push({type,...detail});}});
 return {host,events};
}
test('closing the last authentication view returns to the conversation',()=>{
 const row={id:'login',authentication:true,view:{}}, {host,events}=fixture([row],row.id);
 host.forget(row);assert.equal(host.active,null);assert.equal(events[0].returnToApp,true);
 host.forget(row);assert.equal(events.length,1,'destroyed after explicit close is idempotent');
});
test('closing an authentication tab preserves another open browser page',()=>{
 const row={id:'login',authentication:true,view:{}},other={id:'document',view:{}}, {host,events}=fixture([other,row],row.id);
 host.forget(row);assert.equal(host.active,other.id);assert.equal(events[0].returnToApp,false);
});
test('ordinary empty browser remains available and explicit return still works',()=>{
 const row={id:'page',view:{}},first=fixture([row],row.id);first.host.forget(row);assert.equal(first.events[0].returnToApp,false);
 const second=fixture([row],row.id);second.host.forget(row,{returnToApp:true});assert.equal(second.events[0].returnToApp,true);
});
