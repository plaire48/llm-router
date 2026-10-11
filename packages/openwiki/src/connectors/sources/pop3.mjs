import Pop3 from 'node-pop3';
import {simpleParser} from 'mailparser';
import {createHash} from 'node:crypto';

export const POP3_SERVER=Object.freeze({host:'pop3.samsung.net',port:995,tls:true});
const MAX_UIDL=4*1024*1024, MAX_MAIL=10*1024*1024;
export const digest=value=>createHash('sha256').update(value).digest('hex');

// node-pop3 0.15.3 does not retain a terminator split across TCP chunks.
// Keep five bytes until the complete terminator arrives; leave commands, TLS,
// greeting parsing and stream ownership to the pinned library.
class FragmentSafePop3 extends Pop3 {
  _updateStream(){this.tail=Buffer.alloc(0);this.bodyStarted=false;return super._updateStream();}
  _pushStream(chunk){
    const buffer=Buffer.concat([this.tail,chunk]);
    if(!this.bodyStarted&&buffer.equals(Buffer.from('.\r\n'))){this.tail=Buffer.alloc(0);this._endStream();return;}
    const end=buffer.indexOf(Buffer.from('\r\n.\r\n'));
    if(end>=0){if(end+5!==buffer.length){this.emit('error',new Error('mail_protocol'));return;}this._stream.push(buffer.subarray(0,end));this.tail=Buffer.alloc(0);this._endStream();return;}
    const cut=Math.max(0,buffer.length-5);
    if(cut){this._stream.push(buffer.subarray(0,cut));this.bodyStarted=true;}
    this.tail=buffer.subarray(cut);
  }
}
async function bytes(stream,max){
  if(!stream)throw new Error('mail_protocol');
  const chunks=[];let count=0;
  for await(const chunk of stream){count+=chunk.length;if(count>max)throw new Error('mail_size_limit');chunks.push(chunk);}
  // Latin1 round-trip preserves MIME bytes, including legacy Korean encodings.
  return Buffer.from(Buffer.concat(chunks).toString('latin1').replace(/(^|\r\n)\.\./g,'$1.'),'latin1');
}
function safeError(error,endpoint){
  if(['mail_size_limit','mail_uidl_invalid','mail_protocol','mail_cancelled','mail_timeout'].includes(error?.message))return error.message;
  if(/CERT|TLS|SSL|SELF_SIGNED|VERIFY|ALTNAME/i.test(error?.code||''))return 'mail_tls_error';
  if(error?.command?.startsWith('PASS')||error?.command?.startsWith('USER')){
    // Classify only known Gmail replies. Never return server text or credentials.
    if(endpoint.host==='pop.gmail.com'){
      const reply=String(error.message||'');
      if(/application[- ]specific password|app password required/i.test(reply))return 'mail_gmail_app_password_required';
      if(/web login required|web browser|browser.*login/i.test(reply))return 'mail_gmail_web_login_required';
      if(/POP.*(?:disabled|not enabled)|not enabled.*POP/i.test(reply))return 'mail_gmail_pop_disabled';
      if(/username and password not accepted|invalid credentials|authentication failed|badcredentials/i.test(reply))return 'mail_gmail_credentials_invalid';
    }
    return 'mail_auth_failed';
  }
  return 'mail_connection_failed';
}
export async function pullPop3({user,password,known=null,skip=[],signal,endpoint=POP3_SERVER,timeoutMs=60000}){
  if(typeof user!=='string'||!user.trim()||user.length>320||typeof password!=='string'||!password||password.length>2048||/[\r\n\0]/.test(user+password))throw new Error('mail_input_invalid');
  const client=new FragmentSafePop3({user,password,...endpoint,tls:true,parseStreamToString:false,timeout:15000,tlsOptions:{...endpoint.tlsOptions,rejectUnauthorized:true,minVersion:'TLSv1.2'}});
  let interrupt;
  const stop=()=>{client._socket?.destroy();client.user='';client.password='';};
  const cancelled=new Promise((_,reject)=>{interrupt=()=>{stop();reject(new Error('mail_cancelled'));};signal?.addEventListener('abort',interrupt,{once:true});});
  const timer=setTimeout(()=>{stop();client.emit('error',new Error('mail_timeout'));},timeoutMs);
  try{
    if(signal?.aborted)throw new Error('mail_cancelled');
    return await Promise.race([cancelled,(async()=>{
      await client._connect();
      let delay=60;
      // CAPA is optional in POP3. Only -ERR means unsupported; transport errors fail.
      try{const [,stream]=await client.command('CAPA');const text=(await bytes(stream,65536)).toString('ascii');const value=text.match(/^LOGIN-DELAY\s+(\d+)/im)?.[1];if(value){const seconds=Number(value);if(!Number.isSafeInteger(seconds)||seconds>2147483)throw new Error('mail_protocol');delay=Math.max(60,seconds);}}
      catch(error){if(error.command!=='CAPA'||error.eventName!=='error')throw error;}
      const [,stream]=await client.command('UIDL');
      const uidlBytes=await bytes(stream,MAX_UIDL);if(uidlBytes.some(byte=>byte>126||byte<32&&byte!==10&&byte!==13))throw new Error('mail_uidl_invalid');
      const listing=uidlBytes.toString('ascii').split('\r\n').filter(Boolean);
      const entries=listing.map(line=>{const match=/^([1-9]\d*) ([!-~]{1,70})$/.exec(line);if(!match)throw new Error('mail_uidl_invalid');return {number:Number(match[1]),uidl:match[2]};});
      if(new Set(entries.map(e=>e.uidl)).size!==entries.length||new Set(entries.map(e=>e.number)).size!==entries.length||entries.some(e=>!Number.isSafeInteger(e.number)))throw new Error('mail_uidl_invalid');
      const seen=new Set([...(known||[]),...skip]),pending=known===null?[]:entries.filter(e=>!seen.has(e.uidl));
      const mails=[],failed=[];let total=0,terminated=false;
      for(const entry of pending.slice(0,5)){
        const [,retr]=await client.command('RETR',entry.number);
        let raw;try{raw=await bytes(retr,MAX_MAIL);}catch(error){if(error.message!=='mail_size_limit')throw error;failed.push({...entry,error:'mail_size_limit'});terminated=true;stop();break;}total+=raw.length;if(total>25*1024*1024)break;
        try{
          const parsed=await simpleParser(raw,{skipTextToHtml:true,maxHtmlLengthToParse:MAX_MAIL});
          const address=value=>value?.text?.slice(0,2000)||'';
          if(parsed.attachments.length>100)throw new Error('mail_size_limit');
          let attachmentBudget=16000;
          const attachments=parsed.attachments.map((a,index)=>{
            const filename=(a.filename||'').slice(0,500),sha256=digest(a.content);
            let text='',contentState='stored_bytes_only';
            if(/^(?:text\/(?:plain|csv|markdown)|application\/json)$/.test(a.contentType)&&attachmentBudget>0){
              try{const charset=a.headers.get('content-type')?.params?.charset||'utf-8';text=new TextDecoder(charset,{fatal:true}).decode(a.content).slice(0,attachmentBudget);attachmentBudget-=text.length;contentState=new TextDecoder(charset,{fatal:true}).decode(a.content).length===text.length?'text_read':'text_read_partial';}catch{contentState='encoding_unreadable';}
            }
            return {id:String(index).padStart(3,'0')+'-'+sha256.slice(0,16),filename,contentType:a.contentType,size:a.size,sha256,content:a.content,text,contentState};
          });
          const text=(parsed.text||'').slice(0,32000);
          mails.push({...entry,raw,attachments,normalized:{subject:(parsed.subject||'(제목 없음)').slice(0,1000),from:address(parsed.from),to:address(parsed.to),cc:address(parsed.cc),date:parsed.date?.toISOString()||null,messageId:(parsed.messageId||'').slice(0,1000)||null,inReplyTo:(parsed.inReplyTo||'').slice(0,1000)||null,references:[].concat(parsed.references||[]).slice(0,200).map(value=>String(value).slice(0,1000)),text,truncated:(parsed.text||'').length>text.length,attachments:attachments.map(({content,...metadata})=>metadata)}});
        }catch{failed.push({...entry,error:'mail_parse_failed'});}
      }
      if(!terminated)await client.command('QUIT');
      return {uidls:entries.map(e=>e.uidl),delaySeconds:delay,mails,failed,remaining:Math.max(0,pending.length-mails.length-failed.length)};
    })()]);
  }catch(error){throw new Error(safeError(error,endpoint));}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',interrupt);stop();}
}
