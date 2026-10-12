import {SaxesParser} from 'saxes';

const MARKER='#< CLIXML',NAMESPACE='http://schemas.microsoft.com/powershell/2004/04';
const LIMIT=262144;
// PowerShell escapes UTF-16 code units. Decode once so _x005F_x0041_
// remains the literal _x0041_, rather than turning into A.
const unescape=text=>text.replace(/_x([0-9a-f]{4})_/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
function readableXml(xml){
  const parser=new SaxesParser({xmlns:true}),stack=[],lines=[];
  let field=null,progress=null,unsupported=false;
  parser.on('doctype',()=>{throw Error('clixml_doctype');});
  parser.on('opentag',tag=>{
    stack.push(tag.local);
    if(tag.uri!==NAMESPACE||stack.length===1&&tag.local!=='Objs')throw Error('clixml_namespace');
    if(stack.length===2){
      if(tag.local==='S')field={depth:2,text:''};
      else if(tag.local==='Obj'&&String(tag.attributes.S?.value).toLowerCase()==='progress')progress=[];
      else unsupported=true;
    }else if(progress&&['AV','SD'].includes(tag.local))field={depth:stack.length,text:''};
  });
  const content=text=>{if(field)field.text+=text;};
  parser.on('text',content);parser.on('cdata',content);
  parser.on('closetag',()=>{
    if(field?.depth===stack.length){const text=unescape(field.text);if(progress)progress.push(text);else lines.push(text);field=null;}
    if(stack.length===2&&progress){const text=progress.filter(Boolean).join(' — ');if(text)lines.push(text+'\n');progress=null;}
    stack.pop();
  });
  parser.write(xml).close();
  // Unsupported objects keep their original evidence rather than disappearing.
  if(unsupported)throw Error('clixml_object');
  return lines.join('');
}

// Each pipe owns its decoder. Ordinary text is emitted immediately; only a
// marked XML document waits for its end, with a strict memory bound. Malformed,
// oversized or interrupted XML is preserved verbatim. The disk log stays raw.
export function powerShellOutputDecoder(){
  let pending='',xml=false,lineStart=true,passthrough=false;
  function write(text,final=false){
    if(passthrough)return text;
    pending+=text;let result='';
    while(pending){
      if(xml){
        const end=/<\/Objs\s*>/.exec(pending);
        if(!end){if(!final&&pending.length<=LIMIT)break;result+=pending;pending='';passthrough=true;break;}
        const length=end.index+end[0].length,raw=pending.slice(0,length);
        try{if(raw.length>LIMIT)throw Error('clixml_limit');result+=readableXml(raw.slice(MARKER.length).trimStart());}
        catch{result+=raw;}
        pending=pending.slice(length);xml=false;lineStart=true;continue;
      }
      if(lineStart&&pending.startsWith(MARKER)){xml=true;continue;}
      if(lineStart&&MARKER.startsWith(pending)&&!final)break;
      const newline=pending.indexOf('\n');
      if(newline<0){result+=pending;pending='';lineStart=false;}
      else{result+=pending.slice(0,newline+1);pending=pending.slice(newline+1);lineStart=true;}
    }
    return result;
  }
  return {write:text=>write(text),end:()=>write('',true)};
}

export function processOutputDiagnostic(record){
  if(record?.outputDiagnostic)return record.outputDiagnostic;
  const text=String(record?.output||'');
  if(!/DirUnauthorizedAccessError\s*,\s*Microsoft\.PowerShell\.Commands\.GetChildItemCommand/i.test(text))return null;
  return {kind:'directory_access_denied',message:'폴더 접근이 거부됐어요. 조회 결과가 일부 누락될 수 있어요.',
    instruction:'Get-ChildItem reported a directory access denial. Inspect the error path and the command cwd against the requested project scope. Keep readable results but do not claim complete directory coverage. This is not evidence of an API login failure or a malformed command. Do not silently suppress errors, elevate, change ACLs or execution policy, or rerun. Propose a narrower project-scoped lookup if appropriate; changed execution still requires approval.'};
}
