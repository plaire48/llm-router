// Values of a form in the form's own notation (S1 design, part 3): the model gives a value as the user wrote it, and
// code writes it the way the guide text shows (20XX. XX. XX. → 2026. 10. 1.; 금 ○○○원정 (₩0,000,000) → 금
// 일백일십만원정 (₩1,100,000)). The same parsing tells whether a quote of the user's words holds a value.
import {format} from 'numfmt';

const FULL=/(\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})(?!\d)/g;
const MONTH_DAY=/(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
const DOTTED=/^\s*(\d{1,2})\s*[./]\s*(\d{1,2})\s*\.?\s*$/;
const valid=(y,m,d)=>m>=1&&m<=12&&d>=1&&d<=31?{y,m,d}:null;
// Every date of a text, in order; a month and day take the year of the date before them, or the year given.
export function parseDates(text,{year}={}){
  const value=String(text??''),found=[];
  for(const match of value.matchAll(FULL)){const date=valid(+match[1],+match[2],+match[3]);if(date)found.push({at:match.index,end:match.index+match[0].length,date});}
  for(const match of value.matchAll(MONTH_DAY)){if(found.some(f=>match.index>=f.at&&match.index<f.end))continue;const before=found.filter(f=>f.at<match.index).at(-1)?.date.y??year;const date=before&&valid(before,+match[1],+match[2]);if(date)found.push({at:match.index,end:match.index+match[0].length,date});}
  return found.sort((a,b)=>a.at-b.at).map(f=>f.date);
}
export function parseDate(text,{year}={}){
  const dotted=DOTTED.exec(String(text??''));if(dotted&&year)return valid(year,+dotted[1],+dotted[2]);
  return parseDates(text,{year})[0]??null;
}
// A period: "A부터 B까지", "A ~ B"; the end takes the start's year when it has none, and its month when it names the day
// only ("9월 22일부터 24일까지", "9월 22~24일").
export function parsePeriod(text,{year}={}){
  const value=String(text??'').replace(/까지/g,''),match=/~|∼|부터/.exec(value);if(!match)return null;
  const head=value.slice(0,match.index),tail=value.slice(match.index+match[0].length);
  const start=parseDate(head,{year})??(/\d\s*$/.test(head)?parseDate(head+'일',{year}):null);if(!start)return null;
  const day=/^\s*(\d{1,2})\s*일?\s*\.?\s*$/.exec(tail),end=parseDate(tail,{year:start.y})??(day?valid(start.y,start.m,+day[1]):null);
  return end?{start,end}:null;
}
// The notation of a date guide: 20XX. XX. XX. (the common one), 0000-00-00, 20XX년 XX월 XX일; XX. XX. has no year.
export function formatDate({y,m,d},shape='20XX. XX. XX.'){
  const two=n=>String(n).padStart(2,'0');
  if(/0000-00-00/.test(shape??''))return`${y}-${two(m)}-${two(d)}`;
  if(/년/.test(shape??''))return`${y}년 ${m}월 ${d}일`;
  if(/^\s*X{2}\.\s*X{2}\.?\s*$/.test(shape??''))return`${m}. ${d}.`;
  return`${y}. ${m}. ${d}.`;
}
// The value of an amount in Korean numerals: 일백일십만, 일백십만 and 백십만 are all 1,100,000.
export function hangulAmount(text){
  const digits={일:1,이:2,삼:3,사:4,오:5,육:6,칠:7,팔:8,구:9},small={십:10,백:100,천:1000},large={만:1e4,억:1e8,조:1e12};
  let total=0,section=0,digit=null;const value=String(text??'').replace(/\s/g,'');if(!value)return null;
  for(const ch of value){
    if(Object.hasOwn(digits,ch))digit=digits[ch];
    else if(Object.hasOwn(small,ch)){section+=(digit??1)*small[ch];digit=null;}
    else if(Object.hasOwn(large,ch)){section+=digit??0;total+=(section||1)*large[ch];section=0;digit=null;}
    else return null;
  }
  return total+section+(digit??0);
}
// An amount as Korean documents write it: 1,100,000원, 110만 원, 1,800만, 3.5억, 1억 2,000만, 일백일십만.
export function parseAmount(text){
  const value=String(text??'').replace(/\s|원정|원|₩|\\/g,'');if(!value)return null;
  if(/^[일이삼사오육칠팔구십백천만억조]+$/.test(value))return hangulAmount(value);
  const parts=[...value.matchAll(/(\d[\d,]*(?:\.\d+)?)(억|만)?/g)];
  if(!parts.length||parts.map(part=>part[0]).join('')!==value)return null;
  return Math.round(parts.reduce((sum,part)=>sum+Number(part[1].replace(/,/g,''))*(part[2]==='억'?1e8:part[2]==='만'?1e4:1),0));
}
// Formal Korean numerals, as checks and contracts write an amount: every digit is written, 일 included
// (1,100,000 → 일백일십만). es-hangul's amountToHangul leaves out the 일 of 십 (일백십만).
export function formalAmount(n){
  if(!Number.isSafeInteger(n)||n<=0)return String(n);
  const DIGITS='영일이삼사오육칠팔구',groups=['','만','억','조'],out=[];
  for(let g=0;n>0;g++,n=Math.floor(n/1e4)){
    const part=n%1e4;if(!part)continue;let words='';
    for(const [unit,name] of [[1000,'천'],[100,'백'],[10,'십'],[1,'']]){const d=Math.floor(part/unit)%10;if(d)words+=DIGITS[d]+name;}
    out.unshift(words+groups[g]);
  }
  return out.join('');
}
// A value quoted from a chat request without the request's own ending (…이야, …라는 거야, …해 줘): a form holds the
// value, not the sentence that gave it. Measured 2026-10-01 (gpt-5.6-luna): "…같은 모델로 교체한다는 거야" in a 내용 cell.
const CONVERSATIONAL=/\s*(?:(?:이라는|라는|한다는|하다는|된다는|다는)\s*(?:거야|거예요|겁니다)|이야|이에요|예요|(?:해|하여)\s*(?:줘|주세요|주십시오))\.?$/u;
export const documentText=value=>{const text=String(value??'').trim(),plain=text.replace(CONVERSATIONAL,'').trim();return plain||text;};
// One value in the notation of one guide: a date or a period as the guide writes it (a period guide keeps its own words
// between and after the dates: " ~ ", "부터 … 까지"), an amount in figures or in formal Korean numerals. null: the value
// is not of that kind and is written as given.
function formatted(type,text,shape,parts){
  if(type==='date'){const date=parseDate(text);return date?formatDate(date,shape):null;}
  if(type==='period'){
    const period=parsePeriod(text);if(!period)return null;
    const [a,b]=parts??[shape,shape],at=a&&b&&shape?shape.indexOf(a):-1,end=at>=0?shape.lastIndexOf(b):-1;
    const [middle,tail]=at>=0&&end>=at+a.length?[shape.slice(at+a.length,end),shape.slice(end+b.length)]:[' ~ ',''];
    return`${formatDate(period.start,a)}${middle}${formatDate(period.end,b??a)}${tail}`;
  }
  if(type==='amount'&&shape){const amount=parseAmount(text);return amount===null?null:/[○◯●O]/.test(shape)?formalAmount(amount):format('#,##0',amount);}
  return null;
}
// The text to write for a slot: a date or a period in the notation of its guide, an amount in the form's own frame
// (each guide span in its notation), a cell that holds its own label ("담당: ○○○ (인)") with that label, anything else as
// given without the request's conversational ending.
export function renderValue(slot,value){
  const text=String(value??'').trim(),type=slot?.valueType??'text',guides=slot?.guides??(slot?.guide?[slot.guide]:[]);
  const parts=slot?.parts??(guides.length>1&&type==='period'?guides.slice(0,2):undefined);
  if(slot?.current&&guides.length&&(type==='amount'||slot.inner)){
    let out=slot.current,whole=true;
    for(const guide of guides){const one=formatted(type,text,guide,slot.parts)??(type==='amount'?null:documentText(text));if(one===null){whole=false;break;}out=out.replace(guide,one);}
    if(whole)return out;
  }
  return formatted(type,text,guides[0],parts)??(type==='text'?documentText(text):text);
}
const plain=text=>String(text??'').normalize('NFC').replace(/\s+/g,'').replace(/["'“”‘’]/g,'');
// A quote that names no year holds a date of a year the user stated or of this year (years), not any year: measured
// 2026-10-01 (review of plan 2), "2024년 10월 1일" passed against "시행일은 10월 1일" because the year came from the value.
const yearHeld=(y,quote,years)=>new RegExp(`(?<!\\d)${y}(?!\\d)`).test(String(quote??''))||(years??[new Date().getFullYear()]).includes(y);
// Whether a quote of the user's words holds a value: the same words, or the same date, period or amount written
// another way.
export function quoteHolds(slot,value,quote,{years}={}){
  if(plain(value)&&plain(quote).includes(plain(value)))return true;
  if(slot?.valueType==='date'){const date=parseDate(value);return!!date&&yearHeld(date.y,quote,years)&&parseDates(quote,{year:date.y}).some(d=>d.y===date.y&&d.m===date.m&&d.d===date.d);}
  if(slot?.valueType==='period'){const a=parsePeriod(value),b=parsePeriod(quote,{year:a?.start.y});return!!a&&!!b&&yearHeld(a.start.y,quote,years)&&JSON.stringify(a)===JSON.stringify(b);}
  if(slot?.valueType==='amount'){
    const amount=parseAmount(value);if(amount===null)return false;
    const found=[...String(quote).matchAll(/\d[\d,]*(?:\.\d+)?\s*(?:억\s*(?:\d[\d,]*\s*만)?|만)?|[일이삼사오육칠팔구십백천만억]{2,}/g)].map(match=>parseAmount(match[0]));
    return found.includes(amount);
  }
  return false;
}
// The numbers of a text without separators or leading zeros, and its 만 and 억 amounts written out.
export function numbersIn(text){
  const found=new Set(),value=String(text??'');
  for(const match of value.matchAll(/\d[\d,]*(?:\.\d+)?/g))found.add(match[0].replace(/,/g,'').replace(/^0+(?=\d)/,''));
  for(const match of value.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(만|억)/g))found.add(String(Number(match[1].replace(/,/g,''))*(match[2]==='만'?1e4:1e8)));
  return found;
}
