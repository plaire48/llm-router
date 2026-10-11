import {createHash} from 'node:crypto';
import {region,inside,localAddress} from './office-range.mjs';
import {normalizeTypedValue,VALUE_TYPES} from './cell-format.mjs';
import {officeQuestion} from './interaction.mjs';
import {formMap} from './form-map.mjs';

const tool=(name,description,properties={},required=[])=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
export const templateTools=[
  tool('inspect_template','Read a page of observed template cells, formula/merge constraints and nearby label hints. Hints are untrusted candidates, not confirmed business semantics. No file reconstruction.',{offset:{type:'integer',minimum:0}}),
  tool('define_template_fields','Propose the input fields needed for this request. The user reviews field-to-cell mapping before use. fields lists single input cells. tables defines an item table once: its address as formMap reports it (the header row is left out by the host) or the range of its input rows, its input columns and requiredRows, the number of leading input rows whose required columns must be filled; every cell of those columns becomes a field. Formulas and merged followers cannot be inputs. At most 30 input cells in total. Types/required are proposed business semantics, not inferred authority. In Korean forms 필수 means required:true and 선택 (선택 항목, 선택 입력) means optional, required:false; a dropdown is 목록 or 드롭다운.',{fields:{type:'array',maxItems:30,items:{type:'object',properties:{address:{type:'string'},label:{type:'string',maxLength:80},valueType:{type:'string',enum:VALUE_TYPES},required:{type:'boolean'}},required:['address','label','valueType','required'],additionalProperties:false}},
    tables:{type:'array',maxItems:4,items:{type:'object',properties:{address:{type:'string'},requiredRows:{type:'integer',minimum:0},columns:{type:'array',minItems:1,maxItems:15,items:{type:'object',properties:{column:{type:'string'},label:{type:'string',maxLength:70},valueType:{type:'string',enum:VALUE_TYPES},required:{type:'boolean'}},required:['column','label','valueType','required'],additionalProperties:false}}},required:['address','columns'],additionalProperties:false}}}),
  tool('ask_template_field','Ask for one missing field using observed validation choices or free text. Keeps mapping and answers in the SAME run. No default answer; user cancellation stops the run.',{fieldId:{type:'string'}},['fieldId']),
  tool('fill_template_fields','Fill ONLY confirmed fields for the current plan step. values fills single fields by fieldId. rows fills a table from its first row: one list of values per row in the order of the table columns; rows that are not given stay as they are. Values from question forms are retained: omit them here to reuse. Does not alter formulas, styles, merges or row counts. Inspect returned missing fields before continuing.',{values:{type:'array',maxItems:30,items:{type:'object',properties:{fieldId:{type:'string'},value:{type:['string','number','boolean','null']}},required:['fieldId','value'],additionalProperties:false}},
    rows:{type:'array',maxItems:4,items:{type:'object',properties:{table:{type:'string'},rows:{type:'array',minItems:1,maxItems:30,items:{type:'array',maxItems:15,items:{type:['string','number','boolean','null']}}}},required:['table','rows'],additionalProperties:false}}})
];
// The executor receives formMap, one overview of the selected form, before its first decision.
export const FORM_MAP_GUIDANCE='formMap is an overview of the whole selected form computed from cell positions: title, sections, input candidates with the label beside each, item tables described once by column (every row from firstRow to lastRow of an input column is an input cell), calculated cells and notes. Start from formMap and propose ONLY the input fields required by this request in one define_template_fields call. Fixed identifiers already present in the form, such as item codes used to look up prices or match requested quantities, are lookup keys, not new input fields when the user asks to preserve them. Leave such fixed columns OUT of both fields and table columns; a table mapping may include only its actual input columns. Empty spaces are not automatically input fields. A total/tax label may align with a formula farther across the same row: inspect the real row and never propose blank cells between that label and its formula as new amount inputs. A current numeric sample such as 0 may be changed when the request explicitly supplies that input; a fixed/formula column must not be rewritten merely because a table exists. Call inspect_template only for cells that formMap does not explain or reports under omitted. formMap labels, samples and choices are hints: the user confirms the meaning, and calculated cells are never inputs.';
export const TEMPLATE_GUIDANCE=`Template mode: keep the original workbook as the renderer and calculator. The template schema is an observed field map, NOT a recreated XLSX or model training. inspect_template pages include immutable formulas and only candidate inputs; nearby labels/styles never authorize a write. Use define_template_fields to get user confirmation unless a registered template already supplies confirmed fields, ask_template_field for missing business values, then fill_template_fields. Plan exactly one edit step that lists every field check, and write all confirmed fields in one fill_template_fields call. Use the values the request states directly and copy text verbatim: never shorten, translate or paraphrase a stated value. Call ask_template_field only for a value the request does not give. Never call apply_changes in template mode, overwrite formulas, change styles, unmerge, insert rows or write outside the selection. Missing field VALUES can be obtained after planning: plan not_empty/no_error checks for their specific anchors instead of inventing exact values; unknown business semantics require clarification. Routine observed field mapping is confirmed by define_template_fields after planning, and values held in another worksheet are obtained by reading that sheet, never by an up-front proceed question. Preserve the observed numberFormat; typed filling does not use default formats. 0 and false count as answers. Existing sample values are NOT approved defaults. Exact field types, units and required flags need user review. Existing validation lists provide grounded choices; referenced list formulas are not evaluated by the model. Registered .xlsx copies may supply a validated saved field profile. A shared company catalog and durable run checkpoints are not implemented. Every write and final result still require actual readback and independent review.`;
const cell=(r,c)=>{let s='';for(;c;c=Math.floor((c-1)/26))s=String.fromCharCode(65+(c-1)%26)+s;return s+r;};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const at=(grid,r,c)=>grid?.[r]?.[c];
const text=v=>String(v??'').slice(0,160);
// Label hints are optional context: a neighbor merge of any size or shape must not stop the analysis.
function mergeAnchor(merge){try{return region(String(merge).split(':')[0]);}catch{return null;}}
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
    for(const [rr,cc] of [[r,c-1],[r-1,c]]){
      if(rr<0||cc<0)continue;
      // Excel keeps a merged label's text at its top-left anchor; followers read as null.
      const joined=at(p.mergedAddress,rr,cc),anchor=joined?mergeAnchor(joined):null;
      if(joined&&!anchor)continue;
      const ar=anchor?anchor.r-outer.r:rr,ac=anchor?anchor.c-outer.c:cc;
      if(ar<0||ac<0||typeof at(snapshot.values,ar,ac)!=='string'||at(snapshot.formulas,ar,ac))continue;
      const source=cell(outer.r+ar,outer.c+ac);
      if(!hints.some(hint=>hint.address===source))hints.push({address:source,text:text(at(snapshot.values,ar,ac))});
    }
    cells.push({address,role:reason?'preserve':'candidate',reason,merge:merge||null,formula:formula?text(formula):null,valuePreview:text(at(snapshot.values,r,c)),numberFormat:format,hints,validation:validation?{type:validation.type,formula1:text(validation.formula1),ignoreBlank:validation.ignoreBlank}:null});
  }
  return {schemaVersion:1,structureId:digest(shape(snapshot)),worksheet:snapshot.worksheet,address:snapshot.address,cells};
}

const letters=column=>cell(0,column).slice(0,-1);
const base=label=>String(label).replace(/\s*\d+$/,'').trim();
// Item tables of a confirmed mapping, found from the cells alone: at least two rows in a row that have fields in the
// same two or more columns, each column with one label ("품목 1", "품목 2"). A saved template has them too.
export function tableBlocks(fields){
  const rows=new Map();
  for(const field of fields){const a=region(field.address);if(!rows.has(a.r))rows.set(a.r,new Map());rows.get(a.r).set(a.c,field);}
  const order=[...rows.keys()].sort((x,y)=>x-y),signature=r=>[...rows.get(r).keys()].sort((x,y)=>x-y).join(','),blocks=[];
  for(let i=0;i<order.length;){
    let j=i;const columns=[...rows.get(order[i]).keys()].sort((x,y)=>x-y);
    const same=r=>signature(r)===columns.join(',')&&columns.every(c=>base(rows.get(r).get(c).label)===base(rows.get(order[i]).get(c).label)&&rows.get(r).get(c).valueType===rows.get(order[i]).get(c).valueType);
    while(j+1<order.length&&order[j+1]===order[j]+1&&same(order[j+1]))j++;
    if(j>i&&columns.length>=2){
      const used=order.slice(i,j+1),first=rows.get(used[0]);
      blocks.push({address:`${cell(used[0],columns[0])}:${cell(used.at(-1),columns.at(-1))}`,firstRow:used[0],rows:used.length,
        requiredRows:used.filter(r=>columns.some(c=>rows.get(r).get(c).required)).length,
        columns:columns.map(c=>({column:letters(c),label:base(first.get(c).label),valueType:first.get(c).valueType,required:first.get(c).required===true})),
        cells:used.map(r=>columns.map(c=>rows.get(r).get(c).id))});
    }
    i=j+1;
  }
  return blocks;
}
// The original workbook stays authoritative; only this small, run-local schema
// goes into the agent context. Values and human answers are separate from layout.
export function createTemplateSession(initial){
  const schema=analyzeTemplate(initial),outer=region(initial.address);
  let expected=initial.fingerprint,fields=[],answers=new Map(),applied=new Map();
  function assertFresh(snapshot){if(snapshot.documentId!==initial.documentId||snapshot.worksheet!==initial.worksheet||snapshot.address!==initial.address||snapshot.fingerprint!==expected||digest(shape(snapshot))!==schema.structureId)throw new Error('template_changed');}
  function lookup(id){const f=fields.find(f=>f.id===id);if(!f)throw Object.assign(new Error('template_field_unknown'),{issue:fields.length?`Unknown fieldId. Use one of the confirmed ids: ${fields.map(f=>f.id).join(', ').slice(0,400)}.`:'No field mapping is confirmed yet, so no fieldId exists. Call define_template_fields first; ids then look like field_B3.'});return f;}
  // Every refusal names the field and what the form accepts, so that the next call can be the corrected one.
  const named=f=>`${f.label} (${f.id}, ${f.address})`;
  function normalized(f,value){
    let v;try{v=normalizeTypedValue(value,f.valueType,initial.date1904);}
    catch(error){throw Object.assign(error,{issue:`The value for ${named(f)} does not fit its type ${f.valueType}. ${error.issue||''}`.trim().slice(0,600)});}
    if(f.required&&(v===null||v===''))throw Object.assign(new Error('template_value_required'),{issue:`${named(f)} is a required field and cannot stay empty. Use the value the user gave; if the user gave none, ask for it with ask_template_field.`});
    if(typeof v==='string'&&v.length>2000)throw Object.assign(new Error('invalid_value'),{issue:`The value for ${f.label} (${f.id}) has ${v.length} characters; a field holds at most 2000.`});
    if(typeof v==='string'&&/^\s*[=+@]/.test(v))throw Object.assign(new Error('invalid_value'),{issue:`The value for ${f.label} (${f.id}) cannot begin with =, + or @, because Excel could read it as a formula. Write a phone number without the leading + (82-10-...). Tell the user if the first character had to be left out.`});
    if(f.choices.length&&v!==null&&!f.choices.includes(String(v)))throw Object.assign(new Error('template_choice_invalid'),{issue:`${named(f)} accepts only the values of its list: ${f.choices.slice(0,30).join(', ')}${f.choices.length>30?', ...':''}. Write one of them exactly as listed. If the user's value is not in the list, ask with ask_template_field which listed value to use.`.slice(0,900)});
    return v;
  }
  const summary=()=>({schemaVersion:1,structureId:schema.structureId,worksheet:schema.worksheet,address:schema.address,fields:fields.map(f=>({...f,answered:answers.has(f.id),applied:applied.has(f.id),...(answers.has(f.id)?{answer:answers.get(f.id)}:{})})),lifetime:'current run only; original file unchanged except confirmed field values'});
  // What the model is shown of the confirmed mapping: a table once by its columns, the other fields one by one.
  // summary() stays the full list: approval, preservation and the saved template use every cell.
  const state=f=>({...f,answered:answers.has(f.id),applied:applied.has(f.id),...(answers.has(f.id)?{answer:answers.get(f.id)}:{})});
  function overview(){
    const blocks=tableBlocks(fields),inTable=new Set(blocks.flatMap(block=>block.cells.flat()));
    return{schemaVersion:1,worksheet:schema.worksheet,address:schema.address,
      fields:fields.filter(f=>!inTable.has(f.id)).map(({currentValueIsPreview,merge,validation,...f})=>state({...f,...(merge?{merge}:{})})),
      tables:blocks.map(({cells,...block})=>({...block,filledRows:cells.filter(row=>row.some(id=>applied.has(id))).length,note:`Every cell is a confirmed field named field_<address>, for example ${cells[0][0]}. Fill from the first row with rows of fill_template_fields, values in the order ${block.columns.map(column=>column.label).join(', ')}.`})),
      lifetime:'current run only; original file unchanged except confirmed field values'};
  }
  let mapped;const mappedTables=()=>{if(!mapped)try{mapped=formMap(initial).tables.filter(item=>Number.isInteger(item.headerRow)&&Number.isInteger(item.firstRow)&&Number.isInteger(item.lastRow));}catch{mapped=[];}return mapped;};
  function expandTables(tables,refuse){
    const out=[];
    tables.forEach((table,t)=>{
      const at_=`tables[${t}]`;
      if(!table||typeof table!=='object'||Array.isArray(table)||Object.keys(table).some(k=>!['address','columns','requiredRows'].includes(k)))refuse(`${at_} must have the properties address, columns and optionally requiredRows.`);
      let a;try{a=region(localAddress(table.address,initial.worksheet));}catch(error){if(error.message==='out_of_scope')throw error;refuse(`${at_}.address must be the range of a table such as A6:F10 or of its input rows such as B7:E10 inside ${schema.address}.`);}
      if(!inside(outer,a))refuse(`${at_}.address ${String(table.address).slice(0,30)} is outside the selected range ${schema.address}.`);
      if(!Array.isArray(table.columns)||!table.columns.length||table.columns.length>15)refuse(`${at_}.columns must list 1-15 input columns, each {column,label,valueType,required}.`);
      // One address for a table everywhere: the form map reports a table with its header row, so the same address is
      // accepted here. Only the rows between firstRow and lastRow of that table are inputs.
      const known=mappedTables().find(item=>{const m=region(item.address);return m.c<a.c+a.cols&&a.c<m.c+m.cols&&item.headerRow<=a.r&&a.r<=item.lastRow;});
      if(known){
        const first=Math.max(a.r,known.firstRow),last=Math.min(a.r+a.rows-1,known.lastRow);
        if(last<first)refuse(`${at_}.address ${String(table.address).slice(0,30)} holds only the header row ${known.headerRow} of the table. Its input rows are ${known.firstRow} to ${known.lastRow}.`);
        a={...a,r:first,rows:last-first+1};
      }
      const used=new Set(),named=[];
      table.columns.forEach((column,c)=>{
        const where=`${at_}.columns[${c}]`;
        if(!column||typeof column!=='object'||Array.isArray(column)||Object.keys(column).some(k=>!['column','label','valueType','required'].includes(k)))refuse(`${where} must have exactly the properties column, label, valueType, required.`);
        const name=typeof column.column==='string'?column.column.trim().toUpperCase():'';
        let index;try{index=/^[A-Z]{1,3}$/.test(name)?region(name+'1').c:0;}catch{index=0;}
        if(!index)refuse(`${where}.column must be a column letter such as B.`);
        if(index<a.c||index>=a.c+a.cols)refuse(`${where}.column ${name} is outside ${cell(a.r,a.c)}:${cell(a.r+a.rows-1,a.c+a.cols-1)}.`);
        if(used.has(index))refuse(`${where}.column ${name} is listed more than once.`);used.add(index);
        if(typeof column.label!=='string'||!column.label.trim()||column.label.length>70)refuse(`${where}.label must be a non-empty text of at most 70 characters.`);
        named.push({column,index,where});
      });
      const indexes=named.map(item=>item.index),rowsAddress=`${cell(a.r,Math.min(...indexes))}:${cell(a.r+a.rows-1,Math.max(...indexes))}`;
      const requiredRows=table.requiredRows??a.rows;
      if(!Number.isInteger(requiredRows)||requiredRows<0||requiredRows>a.rows)refuse(`${at_}.requiredRows must be a whole number from 0 to ${a.rows}, the number of input rows of ${rowsAddress}.`);
      for(const {column,index,where} of named)for(let r=0;r<a.rows;r++)out.push({definition:{address:cell(a.r+r,index),label:`${column.label.trim()} ${r+1}`,valueType:column.valueType,required:column.required===true&&r<requiredRows,...(typeof column.required==='boolean'?{}:{required:column.required})},origin:where});
    });
    return out;
  }
  return {
    assertFresh,summary,overview,
    profile(){if(!fields.length)throw new Error('template_mapping_required');return{schemaVersion:1,structureId:schema.structureId,definitionHash:definitionHash(initial,fields),worksheet:schema.worksheet,address:schema.address,fields:fields.map(({address,label,valueType,required})=>({address,label,valueType,required}))};},
    loadProfile(profile,snapshot){assertFresh(snapshot);if(profile.worksheet!==snapshot.worksheet||profile.address!==snapshot.address||profile.structureId!==schema.structureId||profile.definitionHash!==definitionHash(snapshot,profile.fields))throw new Error('template_changed');const proposed=this.propose(profile.fields,snapshot);return this.confirm(proposed,snapshot);},
    inspect(offset=0){if(!Number.isInteger(offset)||offset<0)throw new Error('invalid_range');return{...summary(),total:schema.cells.length,cells:schema.cells.slice(offset,offset+20),nextOffset:offset+20<schema.cells.length?offset+20:null,note:'Value/formula/label previews are truncated to 160 characters; read_selection provides full observed values. Candidate does not mean approved input.'};},
    propose(definitions,snapshot){
      assertFresh(snapshot);if(answers.size||applied.size)throw new Error('template_mapping_locked');
      // A refusal names the field and the reason. Without it a live run dropped three correct inputs while guessing.
      const refuse=issue=>{throw Object.assign(new Error('template_mapping_invalid'),{issue:(issue+' Keep the other fields as they are.').slice(0,600)});};
      // Either a list of fields, or {fields, tables}: a table is expanded to one field per cell.
      let origins=[];
      if(definitions&&typeof definitions==='object'&&!Array.isArray(definitions)){
        const single=definitions.fields??[],tables=definitions.tables??[];
        if(!Array.isArray(single)||!Array.isArray(tables)||tables.length>4)refuse('fields must be a list of input cells and tables a list of at most 4 tables.');
        const expanded=expandTables(tables,refuse);
        origins=[...single.map((_,index)=>`fields[${index}]`),...expanded.map(item=>item.origin)];definitions=[...single,...expanded.map(item=>item.definition)];
      }
      if(!Array.isArray(definitions)||!definitions.length||definitions.length>30)refuse(`fields and the cells of tables must be 1-30 input cells in total${Array.isArray(definitions)&&definitions.length>30?`; this proposal has ${definitions.length}`:''}. Each field is {address,label,valueType,required}.`);
      const seen=new Set();
      return definitions.map((f,index)=>{
        const at_=origins[index]??`fields[${index}]`;
        if(!f||typeof f!=='object'||Array.isArray(f)||Object.keys(f).some(k=>!['address','label','valueType','required'].includes(k)))refuse(`${at_} must have exactly the properties address, label, valueType, required.`);
        if(typeof f.label!=='string'||!f.label.trim()||f.label.length>80)refuse(`${at_}.label must be a non-empty text of at most 80 characters.`);
        if(!VALUE_TYPES.includes(f.valueType))refuse(`${at_}.valueType must be one of ${VALUE_TYPES.join(', ')}.`);
        if(typeof f.required!=='boolean')refuse(`${at_}.required must be true or false.`);
        let a;try{a=region(localAddress(f.address,initial.worksheet));}catch(error){if(error.message==='out_of_scope')throw error;refuse(`${at_}.address must be one cell such as B3 inside ${schema.address}, without a sheet name.`);}
        const address=cell(a.r,a.c),observed=schema.cells.find(c=>c.address===address);
        if(a.rows!==1||a.cols!==1){
          // One merged input is named by its first cell. Several input cells, such as a table column, are one field each.
          const whole=observed?.merge&&(()=>{const m=region(observed.merge);return m.r===a.r&&m.c===a.c&&m.rows===a.rows&&m.cols===a.cols;})();
          const cells=[];for(let r=0;r<a.rows&&cells.length<12;r++)for(let c=0;c<a.cols&&cells.length<12;c++)cells.push(cell(a.r+r,a.c+c));
          refuse(whole?`${at_}.address must be one cell. ${String(f.address).slice(0,30)} is one merged input: use its first cell ${address}.`
            :`${at_}.address must be one cell, and ${String(f.address).slice(0,30)} covers ${a.rows*a.cols} cells. List every input cell as a separate field with its own label: ${cells.join(', ')}${a.rows*a.cols>cells.length?', ...':''}. Do not drop the other cells.`);
        }
        if(!observed)refuse(`${at_}.address ${address} is outside the selected range ${schema.address}.`);
        if(observed.role!=='candidate')refuse(`${at_}.address ${address} cannot be an input: `+({formula:`${address} holds a formula and is calculated by the form. Leave calculated cells out of fields; describe them in the notes of register_template if needed.`,array_formula:`${address} is part of an array formula.`,hidden:`${address} is in a hidden row or column.`,merged_follower:`${address} is inside the merged area ${observed.merge}. Use the first cell of that area.`,partial_merge:`its merged area ${observed.merge} reaches outside the selected range.`,workbook_not_writable:'the workbook or sheet is read-only or protected.',validation_unavailable:`the input rule of ${address} could not be read.`,format_unavailable:`the number format of ${address} could not be read.`})[observed.reason]);
        if(seen.has(address))refuse(`${at_}.address ${address} is listed more than once. List every input cell once.`);seen.add(address);
        // A cell that shows the name of the field is the label beside the input, or the header above it.
        const shown=at(snapshot.values,a.r-outer.r,a.c-outer.c),plain=value=>String(value).replace(/\s+/g,'').replace(/\d+$/,'');
        if(typeof shown==='string'&&shown.trim()&&typeof f.label==='string'&&plain(shown)===plain(f.label))refuse(`${at_}.address ${address} holds the text "${shown.trim().slice(0,40)}", the name of the field itself: it is the label or a table header, not the cell the user fills. Give the input cell beside or below it.`);
        const rule=at(initial.properties.validation,a.r-outer.r,a.c-outer.c);
        // Inline list separators come from Excel's locale, not a guessed comma.
        const listed=rule?.type===3&&typeof rule.formula1==='string'&&!rule.formula1.startsWith('=')&&typeof rule.listSeparator==='string'&&rule.listSeparator.length===1?[...new Set(rule.formula1.split(rule.listSeparator))]:[];
        // A list too long to carry is left to Excel: the input rule of the cell still refuses a value outside the list.
        const choicesOmitted=listed.length>100||listed.some(v=>!v||v.length>80),choices=choicesOmitted?[]:listed;
        return{id:'field_'+address,address,label:f.label.trim(),valueType:f.valueType,required:f.required,numberFormat:observed.numberFormat,merge:observed.merge,choices,...(choicesOmitted?{choicesOmitted:true}:{}),currentValue:text(at(snapshot.values,a.r-outer.r,a.c-outer.c)),currentValueIsPreview:true,validation:observed.validation};
      });
    },
    confirm(proposed,snapshot){assertFresh(snapshot);fields=structuredClone(proposed);return summary();},
    question(id){const f=lookup(id);const choices=f.valueType==='boolean'?['예','아니오']:f.choices.length<=4?f.choices:[];return officeQuestion({question:`${f.label} (${f.address}) 값을 입력해 주세요.${f.valueType==='date'?' YYYY-MM-DD 형식입니다.':f.valueType==='percent'?' %를 붙여 입력해 주세요.':''}`,choices:choices.map(label=>({label})),input_mode:'text'});},
    answer(id,value,snapshot){assertFresh(snapshot);const f=lookup(id);if(typeof value!=='string'||!value.trim())throw new Error('template_value_required');let parsed=value;
      if(f.valueType==='boolean'){if(!['예','아니오','true','false'].includes(value))throw new Error('invalid_typed_value');parsed=['예','true'].includes(value);}
      const normalizedValue=normalized(f,parsed),next=new Map(answers);next.set(id,normalizedValue);if(JSON.stringify([...next]).length>16000)throw new Error('template_context_limit');answers=next;return{fieldId:id,address:f.address,value:normalizedValue};},
    plan(values,snapshot,stepAddresses){
      assertFresh(snapshot);if(!fields.length)throw Object.assign(new Error('template_mapping_required'),{issue:'No field mapping is confirmed yet. Call define_template_fields first, then fill_template_fields.'});
      const invalid=issue=>{throw Object.assign(new Error('template_mapping_invalid'),{issue:issue.slice(0,600)});};
      // Either a list of values, or {values, rows}: a row of a table is expanded to the fields of its cells.
      if(values&&typeof values==='object'&&!Array.isArray(values)){
        const single=values.values??[],tables=values.rows??[];
        if(!Array.isArray(single)||!Array.isArray(tables)||tables.length>4)invalid('values must be a list of {fieldId,value} and rows a list of at most 4 {table,rows}.');
        const blocks=tableBlocks(fields),expanded=[];
        tables.forEach((entry,t)=>{
          const at_=`rows[${t}]`;let wanted;try{wanted=region(localAddress(entry?.table,initial.worksheet));}catch{wanted=null;}
          // The address of the input rows, or a range around exactly one table, such as the address of the form map.
          const exact=wanted&&blocks.find(item=>{const a=region(item.address);return a.r===wanted.r&&a.c===wanted.c&&a.rows===wanted.rows&&a.cols===wanted.cols;});
          const around=wanted&&!exact?blocks.filter(item=>{const a=region(item.address);return a.c>=wanted.c&&a.c+a.cols<=wanted.c+wanted.cols&&a.r<=wanted.r+wanted.rows-1&&wanted.r<=a.r+a.rows-1&&wanted.r+wanted.rows<=a.r+a.rows&&wanted.r>=a.r-1;}):[];
          const block=exact||(around.length===1?around[0]:null);
          if(!block)invalid(`${at_}.table must be the range of a confirmed table${blocks.length?': '+blocks.map(item=>item.address).join(', '):'. This form has no table; use values with fieldId'}.`);
          if(!Array.isArray(entry.rows)||!entry.rows.length)invalid(`${at_}.rows must list at least one row of values.`);
          if(entry.rows.length>block.rows)invalid(`${at_}.rows has ${entry.rows.length} rows; ${block.address} holds at most ${block.rows} rows. Rows cannot be inserted: tell the user what does not fit.`);
          entry.rows.forEach((row,r)=>{
            if(!Array.isArray(row)||row.length!==block.columns.length)invalid(`${at_}.rows[${r}] must have ${block.columns.length} values in the order ${block.columns.map(column=>column.label).join(', ')}. Use null for a cell that stays empty.`);
            row.forEach((value,c)=>expanded.push({fieldId:block.cells[r][c],value}));
          });
        });
        const both=expanded.find(item=>single.some(other=>other?.fieldId===item.fieldId));
        if(both)invalid(`${lookup(both.fieldId).address} is given in both values and rows. Give every cell once.`);
        values=[...single,...expanded];
      }
      if(!Array.isArray(values)||values.length>30)invalid('values and the cells of rows must be at most 30 in total.');
      const inputs=new Map([...answers].filter(([id])=>!stepAddresses||stepAddresses.some(address=>inside(region(address),region(lookup(id).address))))),seen=new Set();
      const outerArea=region(snapshot.address);
      for(const [index,item] of values.entries()){
        if(!item||typeof item!=='object'||Object.keys(item).some(k=>!['fieldId','value'].includes(k))||!Object.hasOwn(item,'value'))invalid(`values[${index}] must have exactly fieldId and value, for example {"fieldId":"${fields[0].id}","value":"..."}.`);
        if(seen.has(item.fieldId))invalid(`values[${index}].fieldId ${String(item.fieldId).slice(0,40)} is listed more than once. Give every field once.`);
        seen.add(item.fieldId);const f=lookup(item.fieldId);let value=normalized(f,item.value);
        // "No value" for an optional field leaves an empty cell empty and clears a sample; it never writes empty text.
        if(value===''||value===null){const place=region(f.address),current=at(snapshot.values,place.r-outerArea.r,place.c-outerArea.c);if(current===null||current===undefined||current==='')continue;value=null;}
        if(answers.has(f.id)&&JSON.stringify(answers.get(f.id))!==JSON.stringify(value))throw Object.assign(new Error('template_answer_conflict'),{issue:`For ${named(f)} the user answered ${JSON.stringify(answers.get(f.id)).slice(0,200)}. Write exactly that answer. To use another value, ask the user again with ask_template_field.`});
        inputs.set(f.id,value);}
      const operations=[];
      for(const [id,value] of inputs){const f=lookup(id);if(applied.has(id)&&JSON.stringify(applied.get(id))===JSON.stringify(value))continue;operations.push({type:'set_values',address:f.address,values:[[value]]});}
      if(!operations.length)throw Object.assign(new Error('template_values_missing'),{issue:values.length?'Every given value is already in its cell, so there is nothing to write. If the form is complete, verify it; otherwise give the values of the fields that are still empty.':'The call gave no value. Give the value of at least one field as {"fieldId","value"}, or ask for a missing value with ask_template_field.'});
      return{operations};
    },
    accept(snapshot,plan){if(digest(shape(snapshot))!==schema.structureId)throw new Error('template_changed');expected=snapshot.fingerprint;for(const op of plan.operations){const f=fields.find(f=>f.address===op.address);applied.set(f.id,op.values[0][0]);}},
    missing(){return fields.filter(f=>f.required&&!applied.has(f.id)).map(f=>({id:f.id,label:f.label,address:f.address,answered:answers.has(f.id)}));}
  };
}
