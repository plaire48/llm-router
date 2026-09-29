import {createRequire} from 'node:module';
import {copyFile, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';

// Preserve licenses for Mammoth and its installed dependency tree. Some are
// CLI-only dependencies; keeping their notices is harmless and avoids relying
// on bundler-specific tree shaking to decide which notices to distribute.
export async function copyDocumentLicenses(destination) {
  const seen = new Set(), packages = [];
  async function visit(name, parent = import.meta.url) {
    const require = createRequire(parent);
    let entry;
    try {entry = require.resolve(`${name}/package.json`);} catch (error) {
      if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
      entry = require.resolve(name);
    }
    let path, directory = dirname(entry);
    while (directory !== dirname(directory)) {
      const candidate = resolve(directory, 'package.json');
      try {if (JSON.parse(await readFile(candidate, 'utf8')).name === name) {path = candidate; break;}} catch { /* Resolve the named package, not nested type markers. */ }
      directory = dirname(directory);
    }
    if (!path) throw new Error(`Cannot resolve dependency package: ${name}`);
    const pkg = JSON.parse(await readFile(path, 'utf8')), key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    const entries = await readdir(dirname(path));
    let files = entries.filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name));
    // isarray 1.0.0 includes the complete MIT text in its README.
    if (!files.length) files = entries.filter(name => /^readme(\.|$)/i.test(name));
    if (!files.length) throw new Error(`Missing document dependency license: ${key}`);
    const outputDirectory = resolve(destination, key.replaceAll('/', '__'));
    await mkdir(outputDirectory, {recursive: true});
    for (const name of files) await copyFile(resolve(dirname(path), name), resolve(outputDirectory, name));
    packages.push({name: pkg.name, version: pkg.version, license: pkg.license, files});
    for (const name of Object.keys(pkg.dependencies || {})) await visit(name, path);
  }
  await visit('@modelcontextprotocol/sdk');
  await visit('idb');
  await visit('fflate');
  await visit('mammoth');
  await visit('@langchain/textsplitters');
  await visit('@langchain/core');
  await visit('deepagents');
  await visit('langchain');
  await visit('@langchain/langgraph');
  await visit('langsmith');
  await visit('process');
  await visit('path-browserify');
  await visit('util');
  await visit('@mozilla/readability');
  await visit('turndown');
  await visit('turndown-plugin-gfm');
  await visit('typebox');
  await visit('mdast-util-from-markdown');
  await visit('mdast-util-gfm');
  await visit('micromark-extension-gfm');
  await visit('mdast-util-to-string');
  await visit('unist-util-visit-parents');
  await writeFile(resolve(destination, 'packages.json'), JSON.stringify(packages, null, 2) + '\n');
}
