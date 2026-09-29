// A simulated Windows app behind the command contract of the app control
// adapter. It holds one window with controls, values and states, applies an
// input the way the app definition says, and records every input it received.
// No window exists and no input reaches this computer. The product code under
// test is the real adapter: only the command runner is replaced.
//
// Limits of the simulation: a capture is a drawing of the controls with their
// labels and values (eval/app-render.py), not the look of a real app. Where
// the drawing tool is missing a capture is a plain picture and `images` says
// so. Timing, focus and custom-drawn controls are not simulated.
import {writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';

const RENDERER=path.join(path.dirname(fileURLToPath(import.meta.url)),'app-render.py');
// Draws with the helper. Resolves false when the helper or its font is missing.
const draw=spec=>new Promise(resolve=>{
  const child=execFile('python3',[RENDERER],{timeout:15000,windowsHide:true},error=>resolve(!error));
  child.on('error',()=>resolve(false));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(spec));
});

const NATIVE={'invoke':'invoke','select':'select','toggle-on':'toggle_on','toggle-off':'toggle_off','expand':'expand','collapse':'collapse'};
const INSPECT_DEPTH=5,ROW=36;
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
const selector=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,299}$/.test(value);

export function validateApp(app){
  const problems=[],need=(ok,problem)=>{if(!ok)problems.push(problem);};
  if(!app||typeof app!=='object')return ['app_not_object'];
  const window=app.window||{};
  need(Number.isSafeInteger(window.hwnd)&&window.hwnd>0,'window.hwnd');need(Number.isSafeInteger(window.processId),'window.processId');
  need(text(window.processName,100),'window.processName');need(text(window.title,300),'window.title');
  const seen=new Set();
  const walk=(controls,at)=>{
    need(Array.isArray(controls),at);
    for(const [index,control] of (Array.isArray(controls)?controls:[]).entries()){
      const here=`${at}[${index}]`;
      need(selector(control?.selector)&&!seen.has(control.selector),here+'.selector');seen.add(control?.selector);
      need(typeof control?.name==='string'&&control.name.length<=500,here+'.name');need(text(control?.type,60),here+'.type');
      need(control.value===undefined||typeof control.value==='string'&&control.value.length<=4000,here+'.value');
      need(control.toggle===undefined||['On','Off','Indeterminate'].includes(control.toggle),here+'.toggle');
      need(control.selected===undefined||['True','False'].includes(control.selected),here+'.selected');
      need(control.expansion===undefined||['Expanded','Collapsed'].includes(control.expansion),here+'.expansion');
      for(const key of ['password','readOnly','offscreen'])need(control[key]===undefined||typeof control[key]==='boolean',here+'.'+key);
      if(control.children)walk(control.children,here+'.children');
    }
  };
  walk(app.controls,'controls');
  for(const [index,rule] of (app.rules||[]).entries()){
    need(seen.has(rule?.on?.selector),`rules[${index}].on.selector`);need(text(rule?.on?.action,40),`rules[${index}].on.action`);
    need((rule.set||[]).every(item=>seen.has(item?.selector)),`rules[${index}].set`);
    need(rule.record===undefined||text(rule.record,60),`rules[${index}].record`);
  }
  return problems;
}

export function createAppHost(definition,{render=draw}={}){
  const problems=validateApp(definition);
  if(problems.length)throw Object.assign(new Error('app_invalid'),{details:{problems}});
  const app=structuredClone(definition),window={dpi:96,width:900,height:700,...app.window};
  const controls=new Map(),parents=new Map(),commands=[],inputs=[],events=[];let row=0,images='drawn';
  const place=(list,parent,depth)=>{for(const control of list){
    controls.set(control.selector,control);parents.set(control.selector,parent);control.depth=depth;
    Object.assign(control,{x:20+depth*16,y:20+ROW*row++,width:control.width||320,height:control.height||28});
    if(control.children)place(control.children,control,depth+1);
  }};
  place(app.controls,null,1);
  const element=control=>({selector:control.selector,name:control.name,type:control.type,isEnabled:control.enabled!==false,isOffscreen:control.offscreen===true,
    x:control.x,y:control.y,width:control.width,height:control.height,isInvokable:['Button','ListItem','CheckBox','MenuItem','Hyperlink'].includes(control.type)});
  const tree=(list,depth)=>list.map(control=>({...element(control),...(control.children&&depth<INSPECT_DEPTH?{children:tree(control.children,depth+1)}:{})}));
  const find=id=>{const control=controls.get(id);if(!control)throw Object.assign(new Error('element not found'),{code:2});return control;};
  const status=()=>({hwnd:window.hwnd,processId:window.processId,processName:window.processName,windowTitle:window.title,windowDpi:window.dpi,scale:window.dpi/96,coordinateSpace:'physical-screen-pixels'});
  const apply=(control,action,value)=>{
    if(control.enabled===false)throw Object.assign(new Error('element is disabled'),{code:3});
    if(action==='set_value'){if(control.readOnly)throw Object.assign(new Error('element is read only'),{code:3});control.value=value;}
    if(action==='toggle_on')control.toggle='On';
    if(action==='toggle_off')control.toggle='Off';
    if(action==='expand')control.expansion='Expanded';
    if(action==='collapse')control.expansion='Collapsed';
    if(action==='select'){
      const parent=parents.get(control.selector);
      for(const sibling of parent?.children||[])if(sibling.selected!==undefined)sibling.selected='False';
      control.selected='True';if(parent&&parent.value!==undefined)parent.value=control.name;
    }
    inputs.push({action,selector:control.selector,...(action==='set_value'?{value}:{})});
    for(const rule of app.rules||[]){
      if(rule.on.selector!==control.selector||rule.on.action!==action)continue;
      // A rule may depend on what the form holds when the input arrives.
      if(rule.when&&!Object.entries(rule.when).every(([id,expected])=>new RegExp(expected,'u').test(String(controls.get(id)?.value??''))))continue;
      for(const {selector:id,...fields} of rule.set||[])Object.assign(controls.get(id),fields);
      if(rule.record)events.push(rule.record);
      break;
    }
  };
  const runner=async args=>{
    commands.push(args.slice(1,3).join(' '));
    const command=args[1],at=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
    if(command==='list-windows')return [{hwnd:window.hwnd,processId:window.processId,processName:window.processName,title:window.title,width:window.width,height:window.height}];
    if(Number(at('-w'))!==window.hwnd)throw Object.assign(new Error('window not found'),{code:2});
    if(command==='status')return status();
    if(command==='inspect')return {windows:[{hwnd:window.hwnd,elements:tree(app.controls,1)}]};
    if(command==='search'){
      const query=String(args[2]).toLowerCase(),matches=[...controls.values()].filter(control=>control.name.toLowerCase().includes(query)||control.selector.toLowerCase().includes(query)).map(element);
      return {matchCount:Math.min(20,matches.length),hasMore:matches.length>20,matches:matches.slice(0,20)};
    }
    if(command==='get-property'){
      const control=find(args[2]);
      return {elementId:control.selector,element:element(control),properties:{IsPassword:control.password?'True':'False',IsReadOnly:control.readOnly?'True':'False',
        ...(control.selected!==undefined?{IsSelected:control.selected}:{}),...(control.toggle!==undefined?{ToggleState:control.toggle}:{}),...(control.expansion!==undefined?{ExpandCollapseState:control.expansion}:{})}};
    }
    if(command==='get-value'){const control=find(args[2]);return {elementId:control.selector,text:control.value??''};}
    if(command==='screenshot'){
      const whole=args[2]==='--capture-screen',control=whole?null:find(args[2]),width=whole?window.width:control.width,height=whole?window.height:control.height;
      const file=at('--output'),shown=[...controls.values()].filter(item=>item.offscreen!==true).map(({selector,name,type,x,y,width,height,value,toggle,selected,password,readOnly,enabled})=>({selector,name,type,x,y,width,height,value,toggle,selected,password,readOnly,enabled}));
      const drawn=images==='drawn'&&await render({title:window.title,width:window.width,height:window.height,controls:shown,crop:whole?null:{x:control.x,y:control.y,width,height},output:file});
      if(!drawn){
        // A plain picture. The shade changes with every input, so a capture after an input differs from the one before.
        images='plain';const png=new PNG({width,height});png.data.fill(Math.max(40,250-inputs.length*12));await writeFile(file,PNG.sync.write(png));
      }
      return {hwnd:window.hwnd,elementId:whole?null:control.selector,filePath:file,width,height};
    }
    if(command==='set-value'){apply(find(args[2]),'set_value',String(args[3]));return {ok:true};}
    if(command==='invoke'){const action=NATIVE[at('--action')];if(!action)throw Object.assign(new Error('unknown action'),{code:2});apply(find(args[2]),action);return {ok:true};}
    if(['click','hover','drag'].includes(command)){inputs.push({action:'pointer_'+command,selector:find(args[2]).selector});return {ok:true};}
    throw Object.assign(new Error('unknown command'),{code:2});
  };
  return {runner,window:window.hwnd,
    state:()=>({images,inputs:structuredClone(inputs),events:[...events],commands:[...commands],
      controls:Object.fromEntries([...controls].map(([id,control])=>[id,{name:control.name,...(control.value!==undefined?{value:control.value}:{}),...(control.toggle!==undefined?{toggle:control.toggle}:{}),...(control.selected!==undefined?{selected:control.selected}:{}),...(control.expansion!==undefined?{expansion:control.expansion}:{})}]))})};
}
