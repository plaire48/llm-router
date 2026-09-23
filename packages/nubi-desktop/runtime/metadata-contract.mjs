import Ajv from 'ajv';
const name={type:'string',minLength:1,maxLength:200,pattern:'^[^\\u0000-\\u001f]+$'};
const object=(properties,required)=>({type:'object',properties,required,additionalProperties:false});
const array=(items,maxItems)=>({type:'array',items,maxItems});
const schema=object({version:{const:1},engine:name,collectedAt:{type:'string',maxLength:40},tables:array(object({schema:name,name,columns:array(object({name,type:name,primary:{type:'boolean'}},['name','type','primary']),300),references:array(object({schema:name,table:name,from:array(name,30),to:array(name,30)},['schema','table','from','to']),300)},['schema','name','columns','references']),200)},['version','engine','collectedAt','tables']);
const validate=new Ajv().compile(schema);
export function parseMetadata(content){
  const data=JSON.parse(content);
  if(!validate(data)||!Number.isFinite(Date.parse(data.collectedAt)))throw new Error('metadata_invalid');
  if(data.tables.some(t=>new Set(t.columns.map(c=>c.name)).size!==t.columns.length||t.references.some(r=>!r.from.length||r.from.length!==r.to.length)))throw new Error('metadata_invalid');
  return data;
}
