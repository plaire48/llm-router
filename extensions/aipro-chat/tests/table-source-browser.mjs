import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {collectSnapshot} from '../generated/browser-dom.js';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BINARY||chromium.executablePath()});
try {
 const page=await browser.newPage({viewport:{width:900,height:600}});
 await page.setContent(`<main><h1>오늘의 날씨</h1><p>오늘 9.28. 현재 24.7 최저 18 최고 26</p></main>
 <div style="margin-top:1000px"><a href="https://example.org/weather-info?token=PRIVATE_TOKEN"><table><tr><th>오늘 9.27.</th></tr><tr><td>18 / 28</td></tr></table></a></div>
 <section><a href="https://unrelated.test/">다른 링크</a><table><caption>직접 표</caption><tr><td>직접 관찰</td></tr></table></section>`);
 let result=await page.evaluate(collectSnapshot,{query:'오늘 날짜 기온'});
 const linked=result.tables.find(t=>t.rows.some(r=>r.cells.some(c=>c.text.includes('9.27'))));
 assert.deepEqual(linked.enclosingLink,{relationship:'table_inside_link',url:'https://example.org/weather-info'});
 assert.equal(linked.inViewport,false);
 assert(!JSON.stringify(result.tables).includes('PRIVATE_TOKEN'));
 console.log('PASS linked table retains its observed enclosing destination without claiming it was read or merging it with the main card');
 result=await page.evaluate(collectSnapshot,{});
 assert.equal(result.tables.find(t=>t.name==='직접 표').enclosingLink,undefined);
 console.log('PASS a nearby sibling link cannot become a table source');
 await page.setContent('<a id="host" href="https://example.org/shadow"><span id="shadow"></span></a>');
 await page.evaluate(()=>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<table><tr><td>shadow table</td></tr></table>');
 result=await page.evaluate(collectSnapshot,{});
 assert.equal(result.tables[0].enclosingLink.url,'https://example.org/shadow');
 console.log('PASS enclosing link identity survives an open shadow boundary');
 await page.setContent('<a href="https://user:PRIVATE_PASSWORD@example.org/weather"><table><tr><td>private link</td></tr></table></a><a href="javascript:alert(1)"><table><tr><td>action link</td></tr></table></a>');
 result=await page.evaluate(collectSnapshot,{});
 assert(result.tables.every(t=>!t.enclosingLink));assert(!JSON.stringify(result.tables).includes('PRIVATE_PASSWORD'));
 console.log('PASS credentialed and executable destinations never become public source metadata');
}finally{await browser.close();}
