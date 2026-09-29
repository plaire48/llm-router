import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisCheckpoint} from '../analysis-checkpoint.js';
import {resumeMessage} from '../context-state.js';
const step=(n,status='running',outcome)=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,tool:'analysis_research',status,
  analysis:{task:'Compare requirements',doneWhen:'Every criterion has a source',outcome,summary:'Historical advice',uncertainties:['Missing appendix'],sources:[{id:'ev_1',path:'/private/source'}],assignment:{documentIds:['doc_1']}}});
test('restart hints preserve missing work without live worker handles, source contents or approval',()=>{
 const source=step(1);source.analysis.secret='must not persist';source.analysis.task='Bearer secret';
 const saved=analysisCheckpoint(null,[source,step(2,'cancelled'),step(3,'done','partial')],'old-request');
 assert.equal(saved.coverage,'partial_trace_hints');assert.equal(saved.entries.length,3);
 const text=JSON.stringify(saved);assert(!text.includes('secret'));assert(!text.includes('ev_1'));assert(!text.includes('doc_1'));assert(!text.includes('/private/source'));
 source.analysis.uncertainties[0]='changed';assert.equal(saved.entries[0].analysis.uncertainties[0],'Missing appendix');
 const message=resumeMessage({goal:'Read only',analysisCheckpoint:saved}).content;
 assert.match(message,/Previous workers and evidence IDs are unavailable/);assert.match(message,/Never restart cancelled work automatically/);assert.match(message,/not complete assignments/);
 assert.match(message,/Missing appendix/);assert.match(message,/"status":"cancelled"/);assert.match(message,/"outcome":"partial"/);
});
test('successive restarts retain independent hints and prefer unresolved work over complete reports',()=>{
 const trace=Array.from({length:15},(_,n)=>step(n+1,n<6?'done':'running',n<6?'complete':undefined));
 const saved=analysisCheckpoint(null,trace,'old');assert.equal(saved.entries.length,12);assert.equal(saved.omittedAtLeast,3);
 assert.equal(saved.entries.filter(x=>x.status==='running').length,9);
 const restored=analysisCheckpoint(saved);assert.deepEqual(restored,saved);
 restored.entries[0].analysis.uncertainties[0]='changed';assert.equal(saved.entries[0].analysis.uncertainties[0],'Missing appendix');
 const merged=analysisCheckpoint(saved,[step(10,'cancelled')],'old');assert.equal(merged.entries.find(x=>x.traceId===step(10).id).status,'cancelled');
});
test('malformed or unrelated checkpoints do not enter resumed model context',()=>{
 assert.equal(analysisCheckpoint({version:2,entries:[step(1)]}),null);
 assert.equal(analysisCheckpoint(null,[{...step(1),id:'analysis_live_id'}, {...step(2),tool:'click_element'}],'request'),null);
 assert.equal(analysisCheckpoint({version:1,entries:[{requestId:'x',traceId:step(1).id,tool:'analysis_research',status:'done',analysis:{task:{malicious:true}}}]}).entries[0].analysis.task,'');
 assert(!resumeMessage({goal:'Read'}).content.includes('analysisCheckpoint'));
});
