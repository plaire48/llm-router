import {CONTENT_OPERATIONS} from './office-capabilities.mjs';
import {modelJson} from './model-json.mjs';
import {toolArgumentIssues} from '../../../extensions/aipro-chat/tool-validation.js';

// Reuse the shared TypeBox interpreter and redacted JSON Pointer diagnostics.
// Only static schema metadata is returned; raw values/property names are not.
// The same characters the Office host refuses (char.IsControl: U+0000-U+001F and U+007F-U+009F), so that a refusal
// names the field here instead of arriving from Office as one code. Notes keep line breaks and tabs.
const CONTROL='\\u0000-\\u001f\\u007f-\\u009f',CONTROL_IN_NOTES='\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f';
const string=(maxLength,nonblank=false,inline=false)=>({type:'string',maxLength,
  ...(nonblank?{minLength:1,allOf:[{pattern:'\\S'}]}:{}),
  ...(inline?{not:{pattern:`[${CONTROL}]`}}:nonblank?{not:{pattern:`[${CONTROL_IN_NOTES}]`}}:{})});
const singleLine=max=>({...string(max,true),not:{pattern:`[${CONTROL}]`}});
const target=string(100,true),editedText=string(4000,false,true);
const slide={title:singleLine(160),bullets:{type:'array',maxItems:8,items:singleLine(350)},notes:{...string(4000),not:{pattern:`[${CONTROL_IN_NOTES}]`}}};
const fields={
  append_paragraph:{text:singleLine(4000),style:{type:'string',enum:['Normal','Title','Heading1','Heading2','Heading3']}},
  // The whole table: Office writes more than 30 rows as consecutive tables (content-agent.mjs, TABLE_ROWS).
  append_table:{rows:{type:'array',minItems:1,maxItems:200,items:{type:'array',minItems:1,maxItems:8,items:string(500,false,true)}}},
  replace_table_cell:{targetId:target,text:singleLine(500)},replace_text_fragment:{targetId:target,findText:singleLine(400),text:singleLine(400)},replace_notes_fragment:{targetId:target,findText:singleLine(400),text:singleLine(400)},replace_text:{targetId:target,text:editedText},fill_field:{targetId:target,text:editedText},
  // Word form parts (S1): a cell may break lines, a guide is one span of the target's text.
  fill_cell:{targetId:target,text:{type:'string',maxLength:4000,not:{pattern:'[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f]'}}},
  replace_guide:{targetId:target,guide:singleLine(200),text:editedText},
  insert_paragraphs:{after:target,like:target,paragraphs:{type:'array',minItems:1,maxItems:40,items:{type:'object',properties:{text:singleLine(4000),like:target},required:['text'],additionalProperties:false}}},
  remove_paragraph:{targetId:target},
  add_rows:{targetId:{type:'string',pattern:'^t[1-9][0-9]{0,2}$'},count:{type:'integer',minimum:1,maximum:50}},
  add_slide:slide,set_slide_content:{targetId:target,...slide},duplicate_slide:{targetId:target}
};
const objectSchema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
// Whole operations as Office takes them. Measured 2026-09-30 (gpt-5.6-luna): plans written as sentences, or ten slides
// in one plan, were refused with the type enum alone, and the same kind of plan came back until the run needed a person.
const EXAMPLES={
  word:[{type:'append_paragraph',text:'비상 연락망',style:'Title'},{type:'append_table',rows:[['이름','부서'],['김민준','영업1팀']]},{type:'replace_text',targetId:'p-12',text:'바꾼 문단 전체'}],
  powerpoint:[{type:'replace_text_fragment',targetId:'s-256/h-3',findText:'기존 문구',text:'바뀐 문구'},{type:'add_slide',title:'사업 개요',bullets:['첫 문장','둘째 문장'],notes:''},{type:'replace_text',targetId:'s-256/h-3',text:'바꾼 도형 텍스트 전체'}]
};
function reject(code,issues,schema,host){
  // A table longer than one operation continues in the next append_table.
  const rows=issues.some(issue=>issue.path==='/rows'&&issue.rule==='maxItems');
  throw Object.assign(new Error(code),{toolFailure:{error:code,stage:'operation_schema',tool:'apply_operation',argument:'plan',actionIssued:false,
    issues,expectedSchema:structuredClone(schema),...(EXAMPLES[host]&&issues.some(issue=>issue.path===''||issue.path==='/type')?{examples:'One operation per plan, as JSON: '+EXAMPLES[host].map(example=>JSON.stringify(example)).join(' or ')}:{}),
    ...(rows?{hint:'One append_table takes at most 200 rows. Send the first 200 rows (the header first) now, then the rest as the next append_table that starts with the same header row.'}:{}),instruction:'The operation was NOT sent to Office. Correct the listed JSON fields inside plan using expectedSchema. Keep the same requested work, observed target and valid content. Schema validity grants no native scope, approval or completion.'}});
}
export function validateContentOperation(host,input){
  const allowed=CONTENT_OPERATIONS[host]||[];
  const discriminator={type:'object',properties:{type:{type:'string',enum:allowed}},required:['type']};
  let operation;
  try{operation=typeof input==='string'?modelJson(input,'document_schema_invalid'):input;}
  catch{reject('document_schema_invalid',[{path:'',rule:'json'}],discriminator,host);}
  if(!operation||typeof operation!=='object'||Array.isArray(operation))reject('document_schema_invalid',[{path:'',rule:'type'}],discriminator,host);
  if(!allowed.includes(operation.type))reject('unsupported_operation',[{path:'/type',rule:'enum'}],discriminator,host);
  const schema=objectSchema({type:{type:'string',const:operation.type},...fields[operation.type]});
  const issues=toolArgumentIssues(schema,operation);
  if(issues)reject('document_schema_invalid',issues,schema,host);
  if(operation.type==='append_table'){
    const width=operation.rows[0].length,index=operation.rows.findIndex(row=>row.length!==width);
    if(index!==-1)reject('document_schema_invalid',[{path:`/rows/${index}`,rule:'equal_row_width',expected:width}],schema,host);
  }
  return operation;
}
