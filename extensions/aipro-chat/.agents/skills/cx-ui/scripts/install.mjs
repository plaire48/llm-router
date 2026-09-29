#!/usr/bin/env node
import {cp, lstat, mkdir, readFile, readdir, realpath} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function equalTrees(source, target) {
  const expected = (await readdir(source)).sort();
  const actual = (await readdir(target)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) return false;
  for (const name of expected) {
    const a = resolve(source, name), b = resolve(target, name);
    const info = await lstat(a), other = await lstat(b);
    if (other.isSymbolicLink() || info.isDirectory() !== other.isDirectory()) return false;
    if (info.isDirectory() ? !await equalTrees(a, b) : !(await readFile(a)).equals(await readFile(b))) return false;
  }
  return true;
}

const locations = {codex: '.agents/skills/cx-ui', claude: '.claude/skills/cx-ui'};

export async function installSkill(project, {target, check = false} = {}) {
  if (!['all', ...Object.keys(locations)].includes(target)) throw new Error('Target must be codex, claude, or all.');
  const projectRoot = resolve(project);
  // A project-local installation does not change personal agent configuration.
  if (!(await lstat(projectRoot)).isDirectory()) throw new Error('Project must be an existing regular directory.');
  const source = root;
  const selected = target === 'all' ? Object.keys(locations) : [target];
  const installations = [];
  // Preflight every destination before writing either copy.
  for (const tool of selected) {
    const parts = locations[tool].split('/');
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join('/'), info = await exists(resolve(projectRoot, name));
      if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error(`${name} must be a regular directory. No files were changed.`);
    }
    const destination = resolve(projectRoot, locations[tool]);
    const status = !await exists(destination) ? 'missing' : await equalTrees(source, destination) ? 'current' : 'different';
    installations.push({tool, destination, status, changed:false});
  }
  if (!check) {
    const conflict = installations.find(item => item.status === 'different');
    if (conflict) throw new Error(`Existing skill differs: ${conflict.destination}. Compare with ${source}, move the old folder to a backup outside the tool's skills directory, then install again. No files were changed.`);
    for (const item of installations.filter(item => item.status === 'missing')) {
      await mkdir(dirname(item.destination), {recursive:true});
      await cp(source, item.destination, {recursive:true, errorOnExist:true, force:false});
      item.status = 'current'; item.changed = true;
    }
  }
  return {destination:installations[0].destination, changed:installations.some(item => item.changed), installations};
}

export async function selectInstallOptions({project, target, check = false}, ask) {
  if (!target) {
    const choice = (await ask('설치할 도구를 선택하세요.\n1. Codex\n2. Claude Code\n3. 둘 다\n0. 취소\n선택: ')).trim();
    if (choice === '0') return null;
    target = {'1':'codex', '2':'claude', '3':'all', codex:'codex', claude:'claude', all:'all'}[choice];
    if (!target) throw new Error('도구를 선택하지 않았습니다. 파일을 복사하지 않았습니다.');
  }
  if (!['codex', 'claude', 'all'].includes(target)) throw new Error('Target must be codex, claude, or all.');
  if (!project) {
    project = (await ask('설치할 프로젝트 폴더의 경로: ')).trim();
    // Paths pasted from a shell can include matching quotes.
    if (/^(["']).*\1$/.test(project)) project = project.slice(1, -1);
    if (!project) throw new Error('프로젝트 폴더를 지정하지 않았습니다. 파일을 복사하지 않았습니다.');
  }
  return {project, target, check};
}

export async function runInstallCli() {
  let prompt;
  try {
    const args = process.argv.slice(2);
    const usage = 'Usage: node <installer.mjs> [project] [--target codex|claude|all] [--check]';
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
      console.log(usage + '\n옵션 없이 실행하면 도구와 프로젝트 폴더를 선택합니다. 비대화형 실행에는 project와 --target을 모두 지정하세요.');
      return;
    }
    let project;
    const options = {}, seen = new Set();
    for (let i = 0; i < args.length; i++) {
      const option = args[i];
      if (!option.startsWith('--')) {
        if (project !== undefined) throw new Error(usage);
        project = option; continue;
      }
      if (seen.has(option)) throw new Error(usage);
      seen.add(option);
      if (option === '--check') options.check = true;
      else if (option === '--target' && args[i+1] && !args[i+1].startsWith('--')) options.target = args[++i];
      else throw new Error(usage);
    }
    if (options.target && !['codex','claude','all'].includes(options.target)) throw new Error('Target must be codex, claude, or all.');
    if (!project || !options.target) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('설치할 프로젝트와 --target codex|claude|all을 지정하세요. 파일을 복사하지 않았습니다.\n' + usage);
      prompt = createInterface({input:process.stdin, output:process.stdout});
    }
    const controller = new AbortController();
    prompt?.on('SIGINT', () => controller.abort());
    prompt?.on('close', () => controller.abort());
    const selected = await selectInstallOptions({project, ...options}, question => prompt.question(question, {signal:controller.signal}));
    if (!selected) { console.log('설치를 취소했습니다.'); return; }
    // Resolve all chosen destinations before showing or copying any files.
    const preview = await installSkill(selected.project, {...selected, check:true});
    if (prompt && !selected.check) {
      for (const item of preview.installations) console.log(`${item.tool}: ${item.destination}`);
      const confirmed = await prompt.question('위 경로에 설치할까요? [y/N]: ', {signal:controller.signal});
      if (!['y','yes'].includes(confirmed.trim().toLowerCase())) { console.log('설치를 취소했습니다.'); return; }
    }
    const result = selected.check ? preview : await installSkill(selected.project, selected);
    if (selected.check) {
      console.log(JSON.stringify(result, null, 2));
      if (result.installations.some(item => item.status !== 'current')) process.exitCode = 1;
    } else {
      for (const item of result.installations) console.log(`${item.changed ? 'Installed' : 'Already installed'} (${item.tool}): ${item.destination}`);
      if (result.installations.some(item => item.tool === 'codex')) console.log('Codex: $cx-ui 업무 관리 화면을 만들어줘.');
      if (result.installations.some(item => item.tool === 'claude')) console.log('Claude Code: /cx-ui 업무 관리 화면을 만들어줘.');
      console.log('Commit the installed skill folders with your project. CX runtime and React dependencies must be installed separately.');
    }
  } catch (error) { console.error(error.name === 'AbortError' ? '설치를 취소했습니다. 파일을 복사하지 않았습니다.' : error.message); process.exitCode = 1; }
  finally { prompt?.close(); }
}

if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) {
  await runInstallCli();
}
