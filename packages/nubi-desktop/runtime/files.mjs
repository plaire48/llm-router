import {createHash} from 'node:crypto';
import {realpath, lstat, readFile} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isUtf8} from 'node:buffer';

const exec = promisify(execFile);
export const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
export const fail = code => { throw new Error(code); };
export const privatePath = value => /(^|\/)(?:\.git|node_modules|\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|tokens?(?:\..*)?|\.playwright-mcp|auth\.json|id_rsa|id_ed25519)(\/|$)|\.(?:pem|p12|pfx|key)$/i.test(value);
// Why git could not open a folder as a project, as something the user can act on.
export const gitOpenFailure = error => error?.code === 'ENOENT' ? 'git_unavailable' : error?.killed ? 'git_timeout'
  : /dubious ownership/i.test(String(error?.stderr || '')) ? 'git_unsafe_directory' : 'not_git_repository';
export async function git(root, args, options = {}) {
  const {stdout} = await exec('git', ['-C', root, ...args], {maxBuffer: 12 * 1024 * 1024, timeout: 20000, windowsHide: true, ...options});
  return stdout;
}
export function relativeFile(value) {
  if (typeof value !== 'string' || !value || value.length > 1000 || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..') || privatePath(value)) fail('path_scope');
  return value;
}
export async function scopedFile(root, value, {newFile = false} = {}) {
  const rel = relativeFile(value), target = path.resolve(root, rel);
  let actual;
  try { actual = await realpath(target); }
  catch (error) {
    if (!newFile || error.code !== 'ENOENT') throw error;
    actual = path.join(await realpath(path.dirname(target)), path.basename(target));
  }
  const inside = path.relative(root, actual);
  if (inside.startsWith('..' + path.sep) || inside === '..' || path.isAbsolute(inside) || !inside) fail('path_scope');
  return target;
}
export async function readSource(root, rel) {
  const target = await scopedFile(root, rel), stat = await lstat(target);
  if (!stat.isFile() || stat.size > 1024 * 1024) fail('file_too_large');
  const bytes = await readFile(target);
  if (bytes.includes(0)) fail('binary_file');
  if (!isUtf8(bytes)) fail('file_encoding');
  const content = bytes.toString('utf8');
  return {path: rel, content, hash: hash(bytes), lines: content.split('\n').length};
}
export async function listFiles(root, {within} = {}) {
  if(within)relativeFile(within);
  // Narrow at Git enumeration, before the cap, so a large repository remains searchable.
  const raw = await git(root, ['--literal-pathspecs', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', ...(within?['--',within]:[])]);
  const all = [...new Set(raw.split('\0').filter(Boolean))].filter(p => !privatePath(p) && !/(^|\/)(?:dist|build|coverage|verification|\.next)(\/|$)/.test(p));
  return {paths: all.slice(0, 20000), truncated: all.length > 20000};
}
export async function snapshot(root) {
  const head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim();
  const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const diff = await git(root, ['diff', 'HEAD', '--binary', '--no-ext-diff']);
  const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  const entries = [];
  for (const rel of untracked) {
    if (privatePath(rel)) continue;
    try { const file = await readSource(root, rel); entries.push([rel, file.hash]); } catch { entries.push([rel, 'unreadable']); }
  }
  return {head, dirty: !!status, fingerprint: hash(JSON.stringify([head, status, hash(diff), entries])), status, diff};
}
