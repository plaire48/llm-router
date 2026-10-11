import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import inject from '@rollup/plugin-inject';
export default defineConfig({plugins:[{...inject({process:'process/browser',include:/\/(?:util|path-browserify|micromatch|picomatch|braces)\/.*\.js$/}),enforce:'post'}],resolve:{
  dedupe:['@langchain/core','langchain','deepagents','minisearch','zod'],
  alias:{'node:fs/promises':fileURLToPath(new URL('./browser-unavailable-fs.js',import.meta.url)), 'node:path':'path-browserify', path:'path-browserify', util:'util/'},
}});
