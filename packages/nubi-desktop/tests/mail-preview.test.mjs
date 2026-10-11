import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanMailPreview,mailPreview,mailBodyParts} from '../runtime/mail-preview.mjs';

test('display preview removes tracking URLs and invisible mail padding without changing the source',()=>{
  const mail={subject:'알림',from:'Network <notice@example.test>',text:'[https://cdn.example.test/logo.png]\n예산 승인\u034f\u00ad\n확인: https://example.test/?token=private\n다음 일정 공유'};
  const original=JSON.stringify(mail),preview=mailPreview(mail,[]);
  assert.equal(preview,'예산 승인 확인: 다음 일정 공유');
  assert.equal(JSON.stringify(mail),original);
  assert.equal(cleanMailPreview('https://example.test/image.png'),'');
});
test('reader compacts blank lines and labels HTTP links without losing their original destination',()=>{
  const parts=mailBodyParts('안내\n\n  \n\n열기 https://example.test/a?token=abc\n<script>unsafe()</script> javascript:alert(1)');
  assert.deepEqual(parts,[{text:'안내\n\n열기 '},{href:'https://example.test/a?token=abc',label:'example.test'},{text:'\n<script>unsafe()</script> javascript:alert(1)'}]);
  assert.deepEqual(mailBodyParts('https://['),[{text:'https://['}]);
});
test('sender searches show the opening content, while body and attachment searches retain context',()=>{
  const mail={subject:'안내',from:'Network <notice@example.test>',text:'회의는 금요일입니다. '+ '소개 '.repeat(150)+'승인 마감은 월요일입니다. Network 저작권'};
  assert(mailPreview(mail,['network']).startsWith('회의는 금요일입니다.'));
  assert(mailPreview(mail,['network','승인']).includes('승인 마감은 월요일입니다.'));
  assert.equal(mailPreview(mail,['공급사'],{kind:'attachment',excerpt:'공급사 정산 120만원'}),'공급사 정산 120만원');
});
