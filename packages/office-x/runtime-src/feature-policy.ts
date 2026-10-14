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

// The upstream guide describes an editor model, not COM. Keep it as design
// reference with an explicit native contract at the point where it is loaded.
export function nativeOfficeGuide(value:unknown):string {
 const reference=officeGuide(value);
 return `WINDOWS OFFICE 2016 EXECUTION CONTRACT
This is design/reference material. Only the tools in the CURRENT request are callable.
- Existing forms: read_template (paged originals, blank slots and formats), then inspect_office / execute_office_operations with real handles and independent readback.
- GenOffice canvas coordinates are NOT Office coordinates. Native PowerPoint uses points; derive scale from live PageSetup.SlideWidth/SlideHeight and the source canvas dimensions. Excel ColumnWidth uses character units and RowHeight uses points.
- Upstream apply_ops / execute_slide_script / element IDs / editor transactions are NOT native COM members or handles. Do not forward them to Office. Use structured native operations. apply_slide_ops is the separately exposed file-engine adapter when available.
- Actual document binding and permissions are owned by the VSTO host. Snapshot observations, form maps, rendering previews and rollback copies are different results. Read/capture does not require a saved copy.
- A failed backup does not prove a failed edit. Native review discloses availability; no repeated checkpoint attempts or fake success. Never replay an uncertain write.
- Web and image services and standalone editors are outside this product's enabled surface.
REFERENCE MATERIAL (document/design examples, subordinate to the contract above):
${typeof reference==='string'?reference:JSON.stringify(reference)}`;
}
