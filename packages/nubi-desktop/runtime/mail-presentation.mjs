export const MAIL_SORTS=['relevance','newest','oldest','subject-asc','subject-desc','sender-asc','sender-desc','role-asc','role-desc'];
export const mailRoleLabel=value=>({to:'수신',cc:'참조',bcc:'비밀참조',unknown:'미확인'})[value]||'미확인';
export function mailAddresses(value){return [...String(value||'').matchAll(/[^\s<>;,"()]+@[^\s<>;,"()]+/g)].map(match=>match[0]);}
export function recipientRole(mail,recipient){
 if(!recipient||!recipient.includes('@'))return 'unknown';
 const key=recipient.trim().toLowerCase();
 for(const role of ['to','cc','bcc'])if(mailAddresses(mail[role]).some(address=>address.toLowerCase()===key))return role;
 // Missing To/Cc is not proof of Bcc: aliases and mailing lists are possible.
 return 'unknown';
}
export function mailSender(mail){
 const explicit=mail.sender||{},raw=String(mail.from||'').trim();
 const email=explicit.address||mailAddresses(raw)[0]||'';
 const name=explicit.name||raw.replace(/<[^>]*>/g,'').replace(email,'').trim().replace(/^"|"$/g,'');
 const organization=explicit.department,company=explicit.company;
 return [name,...(organization||company?[organization,company]:[email])].filter(Boolean).join(' / ')||raw||'보낸 사람 미확인';
}
export function mailTableDate(value){
 if(!value)return '날짜 미확인';const date=new Date(value);if(!Number.isFinite(date.getTime()))return '날짜 미확인';
 const pad=n=>String(n).padStart(2,'0');
 return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
