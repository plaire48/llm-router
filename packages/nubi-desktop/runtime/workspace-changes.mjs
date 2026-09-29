import {lstat} from 'node:fs/promises';
import path from 'node:path';
import {git,hash,fail,privatePath,relativeFile,scopedFile} from './files.mjs';

const MAX_ENTRIES = 100;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_PATCH_BYTES = 24 * 1024;
const excluded = rel => privatePath(rel) || /(^|\/)(?:dist|build|coverage|verification|\.next)(\/|$)/.test(rel);

function parseStatus(raw) {
  return raw.split('\0').filter(Boolean).map(entry => {
    const code = entry.slice(0, 2), rel = entry.slice(3);
    if (entry[2] !== ' ' || !rel) fail('workspace_status_invalid');
    return {path: rel, code};
  });
}

function state(code) {
  if (code === '??') return 'untracked';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  return 'modified';
}

export async function inspectWorkspaceChanges(service, {taskId, path: rel} = {}) {
  const root = await service.target(taskId);
  if (rel !== undefined) {
    relativeFile(rel);
    if (excluded(rel)) fail('path_scope');
  }
  const [head, branch, raw] = await Promise.all([
    git(root, ['rev-parse', '--verify', 'HEAD']),
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(root, ['-c', 'core.fsmonitor=false', '-c', 'status.renames=false', '--literal-pathspecs', 'status', '--porcelain=v1', '-z', '--untracked-files=all', ...(rel ? ['--', rel] : [])]),
  ]);
  const all = parseStatus(raw);
  if (rel && all.some(item => item.path !== rel)) fail('path_scope');
  const visible = all.filter(item => !excluded(item.path) && (() => { try { relativeFile(item.path); return true; } catch { return false; } })());
  const base = {head: head.trim(), branch: branch.trim(), dirty: all.length > 0, statusFingerprint: hash(raw), scope: 'task_workspace'};
  if (!rel) return {...base, entries: visible.slice(0, MAX_ENTRIES).map(item => ({...item, state: state(item.code)})), visibleCount: visible.length, excludedCount: all.length - visible.length, truncated: visible.length > MAX_ENTRIES,
    instruction: 'Read-only Git status at this moment. Untracked files need read_source; status does not authorize edits or prove who made a change. Narrow to one file for a bounded diff.'};

  const item = visible[0];
  let currentSize = 0;
  try {
    await scopedFile(root, rel);
    const current = await lstat(path.join(root, rel));
    if (!current.isFile()) fail('path_scope');
    currentSize = current.size;
  } catch (error) {
    if (error.code !== 'ENOENT' || !item?.code.includes('D')) throw error;
  }
  if (!item && currentSize === 0) {
    // An empty tracked file is valid, but a missing path is not.
    try { await lstat(path.join(root, rel)); } catch (error) { if (error.code === 'ENOENT') fail('source_missing'); throw error; }
  }
  const previousSize = await git(root, ['cat-file', '-s', `HEAD:${rel}`]).then(value => Number(value.trim()), () => 0);
  const summary = {...base, path: rel, code: item?.code || '  ', state: item ? state(item.code) : 'clean'};
  if (item?.code === '??') return {...summary, patch: null, patchTruncated: false, instruction: 'Untracked file has no HEAD diff. Read the current source and its rules before planning edits.'};
  if (!item) return {...summary, patch: '', patchTruncated: false, instruction: 'No Git change at this moment. A clean status is not test evidence or source-edit authorization.'};
  if (currentSize > MAX_FILE_BYTES || previousSize > MAX_FILE_BYTES) return {...summary, patch: null, patchTruncated: true, patchUnavailable: 'file_size_limit',
    instruction: 'Git change exists, but the file exceeds the bounded diff size. Do not infer its full content from status.'};
  const diff = await git(root, ['--literal-pathspecs', 'diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--unified=3', '--', rel]);
  const bytes = Buffer.from(diff), truncated = bytes.length > MAX_PATCH_BYTES;
  let end = MAX_PATCH_BYTES;
  if (truncated) {
    end = bytes.lastIndexOf(0x0a, end - 1) + 1 || end;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  }
  return {...summary, patch: truncated ? bytes.subarray(0, end).toString('utf8') : diff, patchBytes: bytes.length, patchHash: hash(bytes), patchTruncated: truncated,
    instruction: truncated ? 'Only the first part of this diff is shown. Read current source and inspect the remaining change before claiming complete review. Git diff is not edit authorization or a passed test.' : 'Read-only HEAD-to-worktree diff. Read current source before editing; Git diff does not grant edit authority or prove tests passed.'};
}
