// Product scope: GenOffice runs inside Office. Removed features cannot be revived by a model call.
export const excludedTools=new Set(['image_search','generate_image','analyze_media','insert_image','open_genoffice_editor']);
export function imageOperation(name:unknown):boolean{return typeof name==='string'&&/picture|image|media|insert_icon|addIcon|add3DModel/i.test(name);}
export function assertNoImageOperations(value:unknown):void{
 if(!value||typeof value!=='object')return;
 if(Array.isArray(value)){value.forEach(assertNoImageOperations);return;}
 for(const [key,item] of Object.entries(value)){
  if((key==='op'||key==='type')&&imageOperation(item)||/^(bulletImage|bulletBlip|image|imageUrl|imageData|imageSource)$/.test(key)||key==='html'&&typeof item==='string'&&/<(?:img|picture|video|audio)\b/i.test(item))throw Error('feature_removed_images');
  assertNoImageOperations(item);
 }
}
