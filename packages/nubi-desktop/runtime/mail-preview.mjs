import {mailTermPosition} from './mail-text.mjs';
// Presentation only: original bodies, hashes and AI evidence stay intact.
export function cleanMailPreview(text='') {
  return String(text).replace(/\[[ \t]*https?:\/\/[^\s\]]+\]/gi,' ')
    .replace(/<?https?:\/\/[^\s<>]+>?/gi,' ')
    .replace(/[\u00ad\u034f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'')
    .replace(/[-_=]{4,}/g,' ').replace(/\s+/g,' ').trim();
}
export function mailPreview(mail,terms=[],match={}) {
  if(['attachment','knowledge'].includes(match.kind))return cleanMailPreview(match.excerpt);
  const text=cleanMailPreview(mail.text),header=`${mail.subject||''} ${mail.from||''} ${mail.to||''} ${mail.cc||''}`.toLocaleLowerCase();
  // Sender-only searches should show the message, not a footer repeating its brand.
  const bodyTerms=terms.filter(term=>mailTermPosition(header,term)<0);
  const positions=bodyTerms.map(term=>mailTermPosition(text,term)).filter(at=>at>=0);
  const start=positions.length?Math.max(0,Math.min(...positions)-70):0;
  return `${start?'…':''}${text.slice(start,start+220)}${text.length>start+220?'…':''}`;
}

export function mailBodyParts(value='') {
  const text=String(value).replace(/\r\n?/g,'\n').split('\n').map(line=>line.trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
  return text.split(/(https?:\/\/[^\s<>"\]]+)/gi).filter(Boolean).map(part=>{
    if(!/^https?:\/\//i.test(part))return {text:part};
    try{const url=new URL(part);return {href:part,label:url.hostname};}catch{return {text:part};}
  });
}
