import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPop3Error,parseUidlListing} from '../../openwiki/src/connectors/sources/pop3.mjs';
import {mailConnectionDiagnostic,mailConnectionErrors} from '../ui/mail-connection-error.mjs';

test('UIDL preserves opaque IDs across whitespace, numbering and identical copies',()=>{
  const parse=text=>parseUidlListing(Buffer.from(text));
  assert.deepEqual(parse(' 1\topaque!  \r\n2   opaque!\r\n3 another'),[{number:1,uidl:'opaque!'},{number:3,uidl:'another'}]);
  assert.deepEqual(parse('8 opaque!'),[{number:8,uidl:'opaque!'}]);
  assert.deepEqual(parse('  \n001 first\n002 '+ 'a'.repeat(1024)),[{number:1,uidl:'first'},{number:2,uidl:'a'.repeat(1024)}]);
  assert.throws(()=>parse('1 '+ 'a'.repeat(1025)),/mail_uidl_id_length/);
  assert.deepEqual(parse(''),[]);
  for(const text of ['0 bad','1 ','1 id extra','1 ok\r2 unsafe'])assert.throws(()=>parse(text),/mail_uidl_format/);
  for(const text of ['1 first\r\n1 second','999999999999999999999 first'])assert.throws(()=>parse(text),/mail_uidl_number_conflict/);
  assert.throws(()=>parse('1 private\0value'),/mail_uidl_characters/);
});
test('connection failures distinguish TLS, transport, authentication, listing and retrieval without server text',()=>{
  const cases=[
    [{code:'ERR_TLS_CERT_ALTNAME_INVALID'},'mail_tls_hostname'],[{code:'CERT_HAS_EXPIRED'},'mail_tls_expired'],
    [{cause:{code:'SELF_SIGNED_CERT_IN_CHAIN'}},'mail_tls_untrusted'],[{code:'ERR_SSL_WRONG_VERSION_NUMBER'},'mail_tls_error'],
    [{code:'ENOTFOUND'},'mail_dns_failed'],[{code:'ECONNREFUSED'},'mail_connection_refused'],[{code:'ETIMEDOUT'},'mail_timeout'],
    [{command:'USER private-account'},'mail_auth_failed'],[{command:'PASS private-password'},'mail_auth_failed'],
    [{command:'UIDL'},'mail_listing_failed'],[{command:'RETR 1'},'mail_retrieval_failed'],
    [{eventName:'bad-server-response'},'mail_protocol'],[{},'mail_connection_failed'],
  ];
  for(const [cause,code] of cases){assert.equal(classifyPop3Error({...cause,message:'private-account private-password server-private'}),code);assert(mailConnectionErrors[code]);const diagnostic=mailConnectionDiagnostic(code);assert.match(diagnostic,/pop3.samsung.net:995/);assert(!diagnostic.includes('private'));}
  for(const code of ['mail_uidl_format','mail_uidl_id_length','mail_uidl_characters','mail_uidl_number_conflict'])assert.equal(classifyPop3Error(Error(code)),code);
  assert.equal(mailConnectionDiagnostic('private-password'),null);
  assert(!JSON.stringify(mailConnectionErrors).includes('POP3 사용 설정'));
});
