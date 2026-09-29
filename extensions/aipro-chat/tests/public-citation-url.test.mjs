import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {publicSourceURL} from '../browser-public-url.js';
test('observed article identifier survives citation redaction while tokens and tracking do not',()=>{
 const url='https://www.daejonilbo.com/news/articleView.html?idxno=1498515&token=PRIVATE&utm_source=PRIVATE#PRIVATE';
 assert.equal(publicSourceURL(url),'https://www.daejonilbo.com/news/articleView.html?idxno=1498515');
 const result=vm.runInNewContext(`(${publicSourceURL.toString()})(url)`,{URL,url});assert.equal(result,publicSourceURL(url));
});
test('article query exception is restricted to the known publisher/path and one numeric identifier',()=>{
 for(const query of ['idxno=SECRET','idxno=1498515&idxno=999','idxno='+ '9'.repeat(100)])assert.equal(publicSourceURL('https://www.daejonilbo.com/news/articleView.html?'+query),'https://www.daejonilbo.com/news/articleView.html');
 for(const url of ['https://private.example/news/articleView.html?idxno=1498515','https://www.daejonilbo.com/auth/callback?idxno=1498515','https://www.daejonilbo.com.evil.test/news/articleView.html?idxno=1498515'])assert(!publicSourceURL(url).includes('?'));
 assert.equal(publicSourceURL('https://user:secret@www.daejonilbo.com/news/articleView.html?idxno=1498515'),null);
});
