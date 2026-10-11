// Only inert raster bytes are eligible for a local preview. Never treat a
// filename/MIME declaration or a successful preview as extracted text.
export function mailImagePreview(bytes){
  if(bytes.length>10*1024*1024)throw Error('document_limit');
  const type=bytes.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':
    bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':
    /^(GIF87a|GIF89a)$/.test(bytes.subarray(0,6).toString('ascii'))?'image/gif':
    bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':null;
  return type?`data:${type};base64,${bytes.toString('base64')}`:null;
}
