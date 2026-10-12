const path=require('node:path');
// Scope PATH to this app and its children. Never write registry/global Git config.
function configureBundledGit({packaged,resourcesPath,platform=process.platform,env=process.env}){
 if(!packaged||platform!=='win32')return null;
 const directory=path.win32.join(resourcesPath,'git','cmd'),executable=path.win32.join(directory,'git.exe');
 const key=Object.keys(env).find(name=>name.toLowerCase()==='path')||'PATH';
 env[key]=directory+';'+(env[key]||'');env.NUBI_BUNDLED_GIT=executable;return executable;
}
module.exports={configureBundledGit};
