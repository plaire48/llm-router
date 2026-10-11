const net=require('node:net');
const socket=net.createConnection(process.env.NUBI_GIT_SOCKET);
let response='';
socket.setTimeout(15000,()=>socket.destroy());
socket.on('connect',()=>socket.write(JSON.stringify({nonce:process.env.NUBI_GIT_NONCE,prompt:process.argv[2]})+'\n'));
socket.on('data',chunk=>{response+=chunk;if(response.length>20000)socket.destroy();});
socket.on('end',()=>{try{const value=JSON.parse(response);if(typeof value.value!=='string'||/[\r\n]/.test(value.value))throw Error();process.stdout.write(value.value+'\n');}catch{process.exitCode=1;}});
socket.on('error',()=>{process.exitCode=1;});
