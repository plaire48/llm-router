// Interactive human terminals only. Agent commands keep their receipt/approval runtime.
const pty=require(require.resolve('node-pty').replace(/app\.asar([\\/])/,'app.asar.unpacked$1'));
const sessions=new Map();
const MAX_PENDING=256*1024,MAX_REPLAY=256*1024;
const send=value=>{if(process.connected)process.send(value);};
const dimensions=(cols,rows)=>({cols:Math.max(2,Math.min(500,Math.trunc(cols)||80)),rows:Math.max(1,Math.min(300,Math.trunc(rows)||24))});
function snapshot(s){return {id:s.id,projectId:s.projectId,state:s.state,output:s.replay,exitCode:s.exitCode};}
function session(args){const s=sessions.get(args.id);if(!s||s.projectId!==args.projectId)throw Error('terminal_session_missing');return s;}
process.on('message',({requestId,action,args={}}={})=>{
 try{
  let result;
  if(action==='open'){
   let s=sessions.get(args.id);
   if(s){if(s.projectId!==args.projectId)throw Error('terminal_session_missing');}
   else{
    if(sessions.size>=12)throw Error('terminal_session_limit');
    const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/(TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|CREDENTIAL|^ELECTRON_|^NUBI_|^NODE_OPTIONS$|^NODE_CHANNEL_FD$)/i.test(name)));
    env.TERM='xterm-256color';env.COLORTERM='truecolor';if(process.platform==='darwin')env.BASH_SILENCE_DEPRECATION_WARNING='1';
    const terminal=pty.spawn(args.executable,args.argv,{cwd:args.cwd,env,name:'xterm-256color',...dimensions(args.cols,args.rows)});
    s={id:args.id,projectId:args.projectId,terminal,state:'running',replay:'',pending:0,attached:true};sessions.set(s.id,s);
    terminal.onData(data=>{
     s.replay=(s.replay+data).slice(-MAX_REPLAY);
     if(s.attached){s.pending+=data.length;send({event:{id:s.id,type:'data',data}});if(s.pending>=MAX_PENDING)terminal.pause();}
    });
    terminal.onExit(({exitCode})=>{s.state='exited';s.exitCode=exitCode;send({event:{id:s.id,type:'exit',exitCode}});});
   }
   s.attached=true;s.pending=0;if(s.state==='running')s.terminal.resume();result=snapshot(s);
  }else if(action==='dispose'){
   for(const s of sessions.values())try{s.terminal.kill();}catch{}sessions.clear();result={closed:true};
  }else{
   const s=session(args);
   if(action==='input'){if(s.state!=='running'||typeof args.data!=='string'||args.data.length>65536)throw Error('terminal_input_invalid');s.terminal.write(args.data);result={accepted:true};}
   else if(action==='resize'){if(s.state==='running'){const {cols,rows}=dimensions(args.cols,args.rows);s.terminal.resize(cols,rows);}result={resized:true};}
   else if(action==='ack'){s.pending=Math.max(0,s.pending-Math.max(0,Math.min(65536,Number(args.length)||0)));if(s.pending<MAX_PENDING/2&&s.state==='running')s.terminal.resume();result={accepted:true};}
   else if(action==='detach'){s.attached=false;s.pending=0;if(s.state==='running')s.terminal.resume();result={detached:true};}
   else if(action==='close'){sessions.delete(s.id);if(s.state==='running')s.terminal.kill();result={closed:true};}
   else throw Error('method_invalid');
  }
  send({requestId,result});
 }catch(error){send({requestId,error:/^terminal_|^method_invalid$/.test(error.message)?error.message:'terminal_start_failed'});}
});
process.on('disconnect',()=>{for(const s of sessions.values())try{s.terminal.kill();}catch{}process.exit(0);});
