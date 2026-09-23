import {createHash} from 'node:crypto';
import {region,inside} from './office-range.mjs';
import {normalizeTypedValue,VALUE_TYPES} from './cell-format.mjs';
import {officeQuestion} from './interaction.mjs';

const tool=(name,description,properties={},required=[])=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
export const templateTools=[
  tool('inspect_template','Read a page of observed template cells, formula/merge constraints and nearby label hints. Hints are untrusted candidates, not confirmed business semantics. No file reconstruction.',{offset:{type:'integer',minimum:0}}),
  tool('define_template_fields','Propose the input fields needed for this request. The user reviews field-to-cell mapping before use. Include ONLY scalar input anchors; formulas and merged followers cannot be inputs. Types/required are proposed business semantics, not inferred authority.',{fields:{type:'array',minItems:1,maxItems:30,items:{type:'object',properties:{address:{type:'string'},label:{type:'string',maxLength:80},valueType:{type:'string',enum:VALUE_TYPES},required:{type:'boolean'}},required:['address','label','valueType','required'],additionalProperties:false}}},['fields']),
  tool('ask_template_field','Ask for one missing field using observed validation choices or free text. Keeps mapping and answers in the SAME run. No default answer; user cancellation stops the run.',{fieldId:{type:'string'}},['fieldId']),
  tool('fill_template_fields','Fill ONLY confirmed fields for the current plan step. Values from question forms are retained: omit them here to reuse. Does not alter formulas, styles, merges or row counts. Inspect returned missing fields before continuing.',{values:{type:'array',maxItems:30,items:{type:'object',properties:{fieldId:{type:'string'},value:{type:['string','number','boolean','null']}},required:['fieldId','value'],additionalProperties:false}}},['values'])
];
export const TEMPLATE_GUIDANCE=`Template mode: keep the original workbook as the renderer and calculator. The template schema is an observed field map, NOT a recreated XLSX or model training. inspect_template pages include immutable formulas and only candidate inputs; nearby labels/styles never authorize a write. Use define_template_fields to get user confirmation, ask_template_field for missing business values, then fill_template_fields for the FIRST unfinished plan step. Never call apply_changes in template mode, overwrite formulas, change styles, unmerge, insert rows or write outside the selection. Missing field VALUES can be obtained after planning: plan not_empty/no_error checks for their specific anchors instead of inventing exact values; missing field MAPPINGS/business rules require clarification. Preserve the observed numberFormat; typed filling does not use default formats. 0 and false count as answers. Existing sample values are NOT approved defaults. Exact field types, units and required flags need user review. Existing validation lists provide grounded choices; referenced list formulas are not evaluated by the model. Registered .xlsx copies may supply a validated saved field profile. A shared company catalog and durable run checkpoints are not implemented. Every write and final result still require actual readback and independent review.`;
const cell=(r,c)=>{let s='';for(;c;c=Math.floor((c-1)/26))s=String.fromCharCode(65+(c-1)%26)+s;return s+r;};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const at=(grid,r,c)=>grid?.[r]?.[c];
const text=v=>String(v??'').slice(0,160);
const shape=s=>({worksheet:s.worksheet,address:s.address,date1904:s.date1904,readOnly:s.readOnly,protected:s.protected,formulas:s.formulas,formats:s.formats,properties:Object.fromEntries(Object.entries(s.properties||{}).filter(([k])=>k!=='validationValid'))});
function definitionHash(snapshot,fields){const outer=region(snapshot.address),inputs=new Set(fields.map(f=>f.address));return digest({shape:shape(snapshot),fixedValues:snapshot.values.map((row,r)=>row.map((v,c)=>inputs.has(cell(outer.r+r,outer.c+c))||snapshot.formulas[r][c]?null:v))});}

export function analyzeTemplate(snapshot){
  const outer=region(snapshot.address),cells=[];
  if(typeof snapshot.readOnly!=='boolean'||typeof snapshot.protected!=='boolean')throw new Error('template_metadata_missing');
  for(const key of ['mergedAddress','arrayFormula','hiddenRow','hiddenColumn','locked','validation']){
    const grid=snapshot.properties?.[key];
    if(!Array.isArray(grid)||grid.length!==outer.rows||grid.some(row=>!Array.isArray(row)||row.length!==outer.cols))throw new Error('template_metadata_missing');
  }
  for(let r=0;r<outer.rows;r++)for(let c=0;c<outer.cols;c++){
    const address=cell(outer.r+r,outer.c+c),formula=at(snapshot.formulas,r,c),p=snapshot.properties;
    const merge=at(p.mergedAddress,r,c),validation=at(p.validation,r,c),format=at(snapshot.formats?.numberFormat,r,c);
    let reason='';
    if(snapshot.readOnly||snapshot.protected)reason='workbook_not_writable';
    else if(formula)reason='formula';
    else if(at(p.arrayFormula,r,c))reason='array_formula';
    else if(at(p.hiddenRow,r,c)||at(p.hiddenColumn,r,c))reason='hidden';
    else if(validation?.status==='unreadable')reason='validation_unavailable';
    else if(typeof format!=='string')reason='format_unavailable';
    else if(merge){const merged=region(merge);if(!inside(outer,merged))reason='partial_merge';else if(merged.r!==outer.r+r||merged.c!==outer.c+c)reason='merged_follower';}
    const hints=[];
    for(const [rr,cc] of [[r,c-1],[r-1,c]])if(rr>=0&&cc>=0&&typeof at(snapshot.values,rr,cc)==='string'&&!at(snapshot.formulas,rr,cc))hints.push({address:cell(outer.r+rr,outer.c+cc),text:text(at(snapshot.values,rr,cc))});
    cells.push({address,role:reason?'preserve':'candidate',reason,merge:merge||null,formula:formula?text(formula):null,valuePreview:text(at(snapshot.values,r,c)),numberFormat:format,hints,validation:validation?{type:validation.type,formula1:text(validation.formula1),ignoreBlank:validation.ignoreBlank}:null});
  }
  return {schemaVersion:1,structureId:digest(shape(snapshot)),worksheet:snapshot.worksheet,address:snapshot.address,cells};
}

// The original workbook stays authoritative; only this small, run-local schema
// goes into the agent context. Values and human answers are separate from layout.
export function createTemplateSession(initial){
  const schema=analyzeTemplate(initial),outer=region(initial.address);
  let expected=initial.fingerprint,fields=[],answers=new Map(),applied=new Map();
  function assertFresh(snapshot){if(snapshot.documentId!==initial.documentId||snapshot.worksheet!==initial.worksheet||snapshot.address!==initial.address||snapshot.fingerprint!==expected||digest(shape(snapshot))!==schema.structureId)throw new Error('template_changed');}
  function lookup(id){const f=fields.find(f=>f.id===id);if(!f)throw new Error('template_field_unknown');return f;}
  function normalized(f,value){
    const v=normalizeTypedValue(value,f.valueType,initial.date1904);
    if(f.required&&(v===null||v===''))throw new Error('template_value_required');
    if(typeof v==='string'&&(v.length>2000||/^\s*[=+@]/.test(v)))throw new Error('invalid_value');
    if(f.choices.length&&v!==null&&!f.choices.includes(String(v)))throw new Error('template_choice_invalid');
    return v;
  }
  const summary=()=>({schemaVersion:1,structureId:schema.structureId,worksheet:schema.worksheet,address:schema.address,fields:fields.map(f=>({...f,answered:answers.has(f.id),applied:applied.has(f.id),...(answers.has(f.id)?{answer:answers.get(f.id)}:{})})),lifetime:'current run only; original file unchanged except confirmed field values'});
  return {
    assertFresh,summary,
    profile(){if(!fields.length)throw new Error('template_mapping_required');return{schemaVersion:1,structureId:schema.structureId,definitionHash:definitionHash(initial,fields),worksheet:schema.worksheet,address:schema.address,fields:fields.map(({address,label,valueType,required})=>({address,label,valueType,required}))};},
    loadProfile(profile,snapshot){assertFresh(snapshot);if(profile.worksheet!==snapshot.worksheet||profile.address!==snapshot.address||profile.structureId!==schema.structureId||profile.definitionHash!==definitionHash(snapshot,profile.fields))throw new Error('template_changed');const proposed=this.propose(profile.fields,snapshot);return this.confirm(proposed,snapshot);},
    inspect(offset=0){if(!Number.isInteger(offset)||offset<0)throw new Error('invalid_range');return{...summary(),total:schema.cells.length,cells:schema.cells.slice(offset,offset+20),nextOffset:offset+20<schema.cells.length?offset+20:null,note:'Value/formula/label previews are truncated to 160 characters; read_selection provides full observed values. Candidate does not mean approved input.'};},
    propose(definitions,snapshot){
      assertFresh(snapshot);if(answers.size||applied.size)throw new Error('template_mapping_locked');
      if(!Array.isArray(definitions)||!definitions.length||definitions.length>30)throw new Error('template_mapping_invalid');
      const seen=new Set();
      return definitions.map(f=>{
        if(!f||Object.keys(f).some(k=>!['address','label','valueType','required'].includes(k))||typeof f.label!=='string'||!f.label.trim()||f.label.length>80||!VALUE_TYPES.includes(f.valueType)||typeof f.required!=='boolean')throw new Error('template_mapping_invalid');
        const a=region(f.address),address=cell(a.r,a.c),observed=schema.cells.find(c=>c.address===address);
        if(a.rows!==1||a.cols!==1||!observed||observed.role!=='candidate'||seen.has(address))throw new Error('template_mapping_invalid');seen.add(address);
        const rule=at(initial.properties.validation,a.r-outer.r,a.c-outer.c);
        // Inline list separators come from Excel's locale, not a guessed comma.
        const choices=rule?.type===3&&typeof rule.formula1==='string'&&!rule.formula1.startsWith('=')&&typeof rule.listSeparator==='string'&&rule.listSeparator.length===1?[...new Set(rule.formula1.split(rule.listSeparator))]:[];
        if(choices.length>100||choices.some(v=>!v||v.length>80))throw new Error('template_validation_unsupported');
        return{id:'field_'+address,address,label:f.label.trim(),valueType:f.valueType,required:f.required,numberFormat:observed.numberFormat,merge:observed.merge,choices,currentValue:text(at(snapshot.values,a.r-outer.r,a.c-outer.c)),currentValueIsPreview:true,validation:observed.validation};
      });
    },
    confirm(proposed,snapshot){assertFresh(snapshot);fields=structuredClone(proposed);return summary();},
    question(id){const f=lookup(id);const choices=f.valueType==='boolean'?['예','아니오']:f.choices.length<=4?f.choices:[];return officeQuestion({question:`${f.label} (${f.address}) 값을 입력해 주세요.${f.valueType==='date'?' YYYY-MM-DD 형식입니다.':f.valueType==='percent'?' %를 붙여 입력해 주세요.':''}`,choices:choices.map(label=>({label})),input_mode:'text'});},
    answer(id,value,snapshot){assertFresh(snapshot);const f=lookup(id);if(typeof value!=='string'||!value.trim())throw new Error('template_value_required');let parsed=value;
      if(f.valueType==='boolean'){if(!['예','아니오','true','false'].includes(value))throw new Error('invalid_typed_value');parsed=['예','true'].includes(value);}
      const normalizedValue=normalized(f,parsed),next=new Map(answers);next.set(id,normalizedValue);if(JSON.stringify([...next]).length>16000)throw new Error('template_context_limit');answers=next;return{fieldId:id,address:f.address,value:normalizedValue};},
    plan(values,snapshot,stepAddresses){
      assertFresh(snapshot);if(!fields.length)throw new Error('template_mapping_required');
      if(!Array.isArray(values)||values.length>30)throw new Error('template_mapping_invalid');
      const inputs=new Map([...answers].filter(([id])=>!stepAddresses||stepAddresses.some(address=>inside(region(address),region(lookup(id).address))))),seen=new Set();
      for(const item of values){if(!item||Object.keys(item).some(k=>!['fieldId','value'].includes(k))||!Object.hasOwn(item,'value')||seen.has(item.fieldId))throw new Error('template_mapping_invalid');seen.add(item.fieldId);const f=lookup(item.fieldId),value=normalized(f,item.value);
        if(answers.has(f.id)&&JSON.stringify(answers.get(f.id))!==JSON.stringify(value))throw new Error('template_answer_conflict');inputs.set(f.id,value);}
      const operations=[];
      for(const [id,value] of inputs){const f=lookup(id);if(applied.has(id)&&JSON.stringify(applied.get(id))===JSON.stringify(value))continue;operations.push({type:'set_values',address:f.address,values:[[value]]});}
      if(!operations.length)throw new Error('template_values_missing');
      return{operations};
    },
    accept(snapshot,plan){if(digest(shape(snapshot))!==schema.structureId)throw new Error('template_changed');expected=snapshot.fingerprint;for(const op of plan.operations){const f=fields.find(f=>f.address===op.address);applied.set(f.id,op.values[0][0]);}},
    missing(){return fields.filter(f=>f.required&&!applied.has(f.id)).map(f=>({id:f.id,label:f.label,address:f.address,answered:answers.has(f.id)}));}
  };
}
