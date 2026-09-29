import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const wikiBrowserBuild = {
  conditions: ['worker'],
  inject: [fileURLToPath(new URL('../browser-process.js', import.meta.url))],
  alias: {'node:fs/promises':fileURLToPath(new URL('../browser-unavailable-fs.js', import.meta.url)), 'node:path':'path-browserify', path:'path-browserify', util:'util/'},
  // Shared OpenWiki source must use the extension's pinned dependency tree.
  plugins: [{name:'openwiki-browser-dependencies', setup(build) {
    build.onResolve({filter:/^(deepagents|langchain|@langchain\/[^/]+|langsmith|zod|minisearch)(\/.*)?$/}, async args => {
      if (args.pluginData?.wikiResolved) return;
      return build.resolve(args.path, {resolveDir:root, kind:args.kind, pluginData:{wikiResolved:true}});
    });
  }}],
};
