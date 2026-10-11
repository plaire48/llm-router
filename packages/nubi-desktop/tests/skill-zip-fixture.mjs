import {crc32,deflateRawSync} from 'node:zlib';
// Minimal stored ZIP fixture permits malformed paths and duplicate entries for boundary tests.
export function zip(records,{deflate=false}={}) {
  const locals=[],central=[];let offset=0;
  for(const record of records) {
    const [rel,value,mode=0o100600]=record,name=Buffer.from(rel),bytes=Buffer.from(value),crc=crc32(bytes),payload=deflate?deflateRawSync(bytes):bytes;
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(crc,14);local.writeUInt32LE(payload.length,18);local.writeUInt16LE(deflate?8:0,8);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(0x314,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(payload.length,20);directory.writeUInt16LE(deflate?8:0,10);directory.writeUInt32LE(bytes.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE((mode*65536)>>>0,38);directory.writeUInt32LE(offset,42);
    locals.push(local,name,payload);central.push(directory,name);offset+=local.length+name.length+payload.length;
  }
  const end=Buffer.alloc(22),index=Buffer.concat(central);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(records.length,8);end.writeUInt16LE(records.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,index,end]);
}
