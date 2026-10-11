import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {ComputerPointer} from '../runtime/computer-pointer.mjs';

function mock(){
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;child.emit('exit',0);};
  const writes=[];child.stdin.on('data',d=>writes.push(d.toString()));const launches=[];
  const pointer=new ComputerPointer({platform:'win32',launch:(...args)=>{launches.push(args);return child;}});
  return {child,writes,launches,pointer};
}
const target={element:{x:-180,y:60,width:120,height:40}};
test('visual pointer sends host physical coordinates to an owned script, never a mouse command',async()=>{
  const {pointer,child,writes,launches}=mock();
  const moving=pointer.move({id:'bound-window'},target);assert.deepEqual(writes,['1 move -120 80 bound-window\n']);
  assert.match(launches[0][0],/WindowsPowerShell\\v1.0\\powershell.exe$/);assert(launches[0][1].includes('-NonInteractive'));assert(!launches[0][1].includes('-ExecutionPolicy'));assert(!launches[0][2].shell);
  child.stdout.write('{"id":1,"available":true,"animated":false}\n');assert.equal((await moving).available,true);
  const hiding=pointer.hide();assert.equal(writes[1],'2 hide\n');child.stdout.write('{"id":2,"available":true}\n');await hiding;pointer.dispose();assert(child.killed);
});
test('helper loss resolves pending display operations without injecting or retrying input',async()=>{
  const {pointer,child,writes}=mock(),pending=pointer.move({id:'bound-window'},target);
  child.emit('exit',1);assert.deepEqual(await pending,{available:false});assert.deepEqual(await pointer.pulse(),{available:false});assert.equal(writes.length,1);
});
test('invalid display coordinates or scope never launch a helper',async()=>{
  const {pointer,launches}=mock();
  assert.equal((await pointer.move({id:'bad\ncommand'},target)).available,false);
  assert.equal((await pointer.move({id:'bound'}, {element:{...target.element,x:Infinity}})).available,false);
  assert.equal(launches.length,0);
});
test('non-Windows display is explicitly unavailable',async()=>{
  const pointer=new ComputerPointer({platform:'darwin',launch:()=>assert.fail('must not launch')});assert.equal((await pointer.move({id:'bound'},target)).available,false);
});
