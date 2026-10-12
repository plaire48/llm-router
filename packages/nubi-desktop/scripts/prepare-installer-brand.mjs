import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {PNG} from 'pngjs';

// Build native NSIS bitmap surfaces from the unchanged approved character.
// All copy stays in accessible native controls, never rasterized in the art.
const source=await readFile('../../extensions/aipro-chat/design/brand/bird-master.png');
const bird=PNG.sync.read(source),output=path.resolve('electron-app/resources/nsis-generated');
await mkdir(output,{recursive:true});
function bitmap(png){
  const stride=(png.width*3+3)&~3,size=stride*png.height,bytes=Buffer.alloc(54+size);
  bytes.write('BM');bytes.writeUInt32LE(bytes.length,2);bytes.writeUInt32LE(54,10);bytes.writeUInt32LE(40,14);
  bytes.writeInt32LE(png.width,18);bytes.writeInt32LE(png.height,22);bytes.writeUInt16LE(1,26);bytes.writeUInt16LE(24,28);bytes.writeUInt32LE(size,34);
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
    const from=(y*png.width+x)*4,to=54+(png.height-y-1)*stride+x*3;
    bytes[to]=png.data[from+2];bytes[to+1]=png.data[from+1];bytes[to+2]=png.data[from];
  }
  return bytes;
}
function draw(width,height,{size,x,y,sidebar=false}){
  const png=new PNG({width,height});
  for(let py=0;py<height;py++)for(let px=0;px<width;px++){
    const at=(py*width+px)*4,t=sidebar?py/height:0;
    const glow=sidebar?Math.max(0,1-Math.hypot(px-width*.55,(py-height*.42)*.8)/(width*.7))*.45:0;
    const top=[241,247,254],bottom=[232,241,254];
    for(let c=0;c<3;c++){const value=top[c]*(1-t)+bottom[c]*t;png.data[at+c]=Math.round(value+(255-value)*glow);}
    png.data[at+3]=255;
  }
  // Area sampling preserves soft alpha edges when reducing the original master.
  const ratio=bird.width/size;
  for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++){
    const left=dx*ratio,right=(dx+1)*ratio,top=dy*ratio,bottom=(dy+1)*ratio;
    let a=0,r=0,g=0,b=0;
    for(let sy=Math.floor(top);sy<Math.ceil(bottom);sy++)for(let sx=Math.floor(left);sx<Math.ceil(right);sx++){
      const weight=(Math.min(sx+1,right)-Math.max(sx,left))*(Math.min(sy+1,bottom)-Math.max(sy,top));
      const at=(sy*bird.width+sx)*4,alpha=bird.data[at+3]/255*weight;
      a+=alpha;r+=bird.data[at]*alpha;g+=bird.data[at+1]*alpha;b+=bird.data[at+2]*alpha;
    }
    if(!a)continue;
    const at=((y+dy)*width+x+dx)*4,alpha=a/(ratio*ratio);
    for(const [c,color] of [r/a,g/a,b/a].entries())png.data[at+c]=Math.round(color*alpha+png.data[at+c]*(1-alpha));
  }
  return png;
}
const assets=[['installer-sidebar',draw(492,942,{size:450,x:21,y:246,sidebar:true})],['installer-header',draw(450,171,{size:159,x:267,y:6})]];
for(const [name,png] of assets){await writeFile(path.join(output,name+'.bmp'),bitmap(png));await writeFile(path.join(output,name+'.png'),PNG.sync.write(png));}
await writeFile(path.join(output,'brand-provenance.json'),JSON.stringify({source:'extensions/aipro-chat/design/brand/bird-master.png',sha256:createHash('sha256').update(source).digest('hex'),scale:3,copyInNativeControls:true},null,2));
console.log('Prepared native installer bird surfaces');
