import {isUtf8} from 'node:buffer';
import {git, fail, relativeFile} from './files.mjs';

const OID = /^[a-f0-9]{40,64}$/;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 500;
const emptyRepository = error => /does not have any commits|unknown revision|not a git repository|Needed a single revision/.test(error.stderr || '');
const visiblePath = value => { try { relativeFile(value); return true; } catch { return false; } };

async function references(root) {
  const raw = await git(root, ['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/heads/', 'refs/remotes/']);
  return raw.split('\n').filter(Boolean).map(line => {
    const [ref, tip] = line.split('\0');
    return {ref, tip, name: ref.replace(/^refs\/(heads|remotes)\//, '')};
  }).filter(row => OID.test(row.tip));
}

async function comparison(root, commit) {
  const metadata = (await git(root, ['show', '-s', '--format=%H%x00%P%x00%aI%x00%an%x00%s', commit])).trimEnd().split('\0');
  const [id, parents, date, author, subject] = metadata;
  const parent = parents.split(' ').filter(Boolean)[0] || null;
  // Merge commits compare with their first parent; root commits compare with an empty tree.
  const args = ['diff-tree', '--root', '-r', '--no-commit-id', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', ...(parent ? [parent, commit] : [commit])];
  const [raw, stats] = await Promise.all([
    git(root, [...args, '--raw', '--abbrev=64', '-z'], {maxBuffer:8 * 1024 * 1024}),
    git(root, [...args, '--numstat', '-z'], {maxBuffer:8 * 1024 * 1024})
  ]);
  const counts = new Map(stats.split('\0').filter(Boolean).map(row => {
    const first = row.indexOf('\t'), second = row.indexOf('\t', first + 1);
    return [row.slice(second + 1), {added:row.slice(0, first) === '-' ? null : Number(row.slice(0, first)), removed:row.slice(first + 1, second) === '-' ? null : Number(row.slice(first + 1, second))}];
  }));
  const tokens = raw.split('\0'), files = [];
  let excludedCount = 0;
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]+) ([a-f0-9]+) ([AMDT])$/.exec(tokens[i]);
    if (!match) fail('git_history_invalid');
    const rel = tokens[i + 1];
    if (!visiblePath(rel)) { excludedCount++; continue; }
    const [, beforeMode, afterMode, beforeId, afterId, status] = match;
    files.push({path:rel, status, beforeMode, afterMode, beforeId, afterId, ...counts.get(rel)});
  }
  return {commit:{id, parent, parents:parents.split(' ').filter(Boolean), date, author, subject}, files, excludedCount};
}

async function blob(root, id, mode) {
  if (/^0+$/.test(id)) return {text:''};
  if (!/^100(644|755)$/.test(mode)) return {unavailable: mode === '160000' ? 'submodule' : 'special_file'};
  if (!OID.test(id)) fail('git_history_invalid');
  const size = Number((await git(root, ['cat-file', '-s', id])).trim());
  if (!Number.isFinite(size) || size > MAX_FILE_BYTES) return {unavailable:'file_size_limit'};
  const bytes = await git(root, ['cat-file', 'blob', id], {encoding:'buffer', maxBuffer:MAX_FILE_BYTES + 1024});
  if (bytes.includes(0)) return {unavailable:'binary_file'};
  if (!isUtf8(bytes)) return {unavailable:'file_encoding'};
  return {text:bytes.toString('utf8')};
}

export async function inspectCommitHistory(service, {branch = 'HEAD', commit, path:rel, view} = {}) {
  service.ready();
  const root = service.root;
  const refs = await references(root).catch(error => { if (emptyRepository(error)) return []; throw error; });
  if (branch !== 'HEAD' && !refs.some(row => row.ref === branch)) fail('git_branch_missing');
  let tip;
  try { tip = (await git(root, ['rev-parse', '--verify', `${branch}^{commit}`])).trim(); }
  catch (error) { if (emptyRepository(error) && !commit) return {commits:[], branches:refs, branch, tip:null}; throw error; }
  if (!OID.test(tip)) fail('git_history_invalid');
  if (!commit) {
    const currentBranch = await git(root, ['symbolic-ref', '--quiet', 'HEAD']).then(value => value.trim(), () => null);
    const text = await git(root, ['log', '-50', '--format=%H%x00%aI%x00%an%x00%s%x00', tip]);
    const parts = text.split('\0'), commits = [];
    for (let i = 0; i + 3 < parts.length; i += 4) commits.push({id:parts[i].trim(), date:parts[i+1], author:parts[i+2], subject:parts[i+3]});
    return {commits, branches:refs, currentBranch, branch, tip, limit:50};
  }
  if (!OID.test(commit)) fail('input_invalid');
  await git(root, ['merge-base', '--is-ancestor', commit, tip]);
  if (view !== 'files' && rel === undefined) {
    // Preserve the existing raw-patch RPC for legacy clients.
    const patch = await git(root, ['show', '--format=fuller', '--no-ext-diff', '--no-textconv', '--no-renames', commit], {maxBuffer:2*1024*1024});
    return {commit, patch:patch.slice(0,200000), truncated:patch.length>200000};
  }
  const result = await comparison(root, commit);
  if (rel === undefined) return {...result, files:result.files.slice(0, MAX_FILES).map(({beforeId,afterId,...file}) => file), totalFiles:result.files.length, truncated:result.files.length > MAX_FILES};
  relativeFile(rel);
  const file = result.files.find(row => row.path === rel);
  if (!file) fail('path_scope');
  const [before, after] = await Promise.all([blob(root, file.beforeId, file.beforeMode), blob(root, file.afterId, file.afterMode)]);
  return {path:rel, commit, parent:result.commit.parent, added:file.added, removed:file.removed, status:file.status, beforeMode:file.beforeMode, afterMode:file.afterMode,
    unavailable:before.unavailable || after.unavailable || null,
    ...(before.unavailable || after.unavailable ? {} : {before:before.text, after:after.text})};
}
