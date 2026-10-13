// Product scope: GenOffice runs inside Office. Removed features cannot be revived by a model call.
export const excludedTools=new Set(['web_search','read_web_page','image_search','generate_image','analyze_media','insert_image','open_genoffice_editor']);
// Keep the upstream editing/design reference without telling the Office Agent
// to call services that this product has removed. Vendor files stay immutable.
export function officeGuide<T>(value:T):T {
 if(typeof value==='string')return value.split('\n').filter(line=>!/(?:web_search|read_web_page|image_search|generate_image|insert_web_image|analyze_media)/.test(line)).join('\n') as T;
 if(Array.isArray(value))return value.map(officeGuide) as T;
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,officeGuide(v)])) as T;
 return value;
}
export function imageOperation(name:unknown):boolean{return typeof name==='string'&&/picture|image|media|insert_icon|addIcon|add3DModel/i.test(name);}
export function assertNoImageOperations(value:unknown):void{
 if(!value||typeof value!=='object')return;
 if(Array.isArray(value)){value.forEach(assertNoImageOperations);return;}
 for(const [key,item] of Object.entries(value)){
  if((key==='op'||key==='type')&&imageOperation(item)||/^(bulletImage|bulletBlip|image|imageUrl|imageData|imageSource)$/.test(key)||key==='html'&&typeof item==='string'&&/<(?:img|picture|video|audio)\b/i.test(item))throw Error('feature_removed_images');
  assertNoImageOperations(item);
 }
}
