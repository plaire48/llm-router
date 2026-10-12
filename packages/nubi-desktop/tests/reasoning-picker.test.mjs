import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const root=fileURLToPath(new URL('..',import.meta.url));
test('Claude reasoning picker uses host capabilities and restored effort with the shared control',async()=>{
  const dir=await mkdtemp(path.join(root,'node_modules/.reasoning-picker-test-'));
  try {
    const output=path.join(dir,'picker.mjs');
    await build({entryPoints:[path.join(root,'ui/ReasoningPicker.jsx')],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
    const {ReasoningPicker}=await import(pathToFileURL(output).href);
    const render=provider=>renderToStaticMarkup(React.createElement(ReasoningPicker,{provider:{provider:'claude',connected:true,...provider},api:async()=>{throw Error('render must not call host');}}));
    const opus={model:'claude-opus-5-5',reasoningOptions:['low','medium','high','xhigh','max']};
    assert.match(render(opus),/--effort medium/,'default is medium');
    for(const value of opus.reasoningOptions){
      const html=render({...opus,reasoningEffort:value});
      assert.match(html,new RegExp(`--effort ${value}`),'restored effort is visible');
      assert.match(html,/nubi-reasoning-trigger/,'same trigger as ChatGPT');
    }
    assert.equal(render({model:'haiku',reasoningOptions:[]}), '','Haiku has no selector');
    assert.equal(render({model:'sonnet'}), '','do not invent unreported capabilities');
    assert.match(render({...opus,reasoningOptions:['max']}),/--effort max/,'only host-advertised values appear');
    assert.doesNotMatch(render(opus),/nubi-claude-effort|<code/,'no separate CLI panel');
  } finally {await rm(dir,{recursive:true,force:true});}
});
