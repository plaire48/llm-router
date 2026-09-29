#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve, dirname} from 'node:path';

// Resolve from the consumer, never from the downloaded skill's own location.
const [project = '.', ...words] = process.argv.slice(2);
const directory = resolve(project);
const packageName = '@e2e/cx-design-system';
try {
  let packageFile;
  try {
    packageFile = createRequire(resolve(directory, 'package.json')).resolve(packageName + '/package.json');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    const local = resolve(directory, 'package.json');
    const candidate = JSON.parse(await readFile(local, 'utf8'));
    if (candidate.name !== packageName) throw new Error('CX 패키지를 찾지 못했습니다. 제공된 TGZ를 설치한 프로젝트 경로를 지정하세요.');
    packageFile = local;
  }
  const packageRoot = dirname(packageFile);
  const pkg = JSON.parse(await readFile(packageFile, 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'agent/manifest.json'), 'utf8'));
  if (pkg.name !== packageName || manifest.package !== packageName || manifest.version !== pkg.version) {
    throw new Error('CX 패키지와 manifest 버전이 일치하지 않습니다. 배포 패키지를 확인하세요.');
  }
  const summary = words.length === 1 && words[0] === '--summary';
  const query = summary ? '' : words.join(' ').toLowerCase().trim();
  const matches = entry => !query || JSON.stringify(entry).toLowerCase().includes(query);
  const components = manifest.portable.filter(matches).map(item => ({name:item.name, props:item.props.map(p=>p.name), source:item.source, docs:item.docs, example:item.example}));
  let library;
  if(manifest.library) {
    const index=JSON.parse(await readFile(resolve(packageRoot,manifest.library),'utf8'));
    const tokens=JSON.parse(await readFile(resolve(packageRoot,index.tokenCatalog),'utf8'));
    if(index.version!==pkg.version||tokens.version!==pkg.version)throw new Error('라이브러리와 패키지 버전이 일치하지 않습니다.');
    const tables=index.tables?JSON.parse(await readFile(resolve(packageRoot,index.tables.contract),'utf8')):null;
    if(tables&&tables.version!==pkg.version)throw new Error('표 계약과 패키지 버전이 일치하지 않습니다.');
    const feedback=index.feedback?JSON.parse(await readFile(resolve(packageRoot,index.feedback.contract),'utf8')):null;
    if(feedback&&feedback.version!==pkg.version)throw new Error('피드백 계약과 패키지 버전이 일치하지 않습니다.');
    library={guide:index.entry,source:manifest.library,defaultTemplate:index.defaultTemplate,
      tables:tables?{...index.tables,publicComponent:tables.publicComponent,features:tables.features.filter(matches),knownGaps:tables.knownGaps}:undefined,
      feedback:feedback?{...index.feedback,apis:feedback.apis,timing:feedback.timing,features:feedback.features.filter(matches),notSupported:feedback.notSupported}:undefined,
      templates:index.templates.filter(matches),recipes:index.recipes.filter(matches),layouts:index.layouts,
      tokens:tokens.tokens.filter(item=>(query||item.recommended)&&matches({...item,categoryLabel:tokens.categories.find(category=>category.id===item.category)?.label})).map(({id,label,css,baseValue,resolvedBase,tier,recommended,usedBy})=>({id,label,css,baseValue,resolvedBase,tier,recommended,usedBy})),
      commands:{list:'node node_modules/@e2e/cx-design-system/scripts/template.mjs list',add:'node node_modules/@e2e/cx-design-system/scripts/template.mjs add <template-id> --to <empty-directory>'},
      note:'templates의 파일과 props를 확인하고 필요한 화면만 복사하세요. 토큰의 조건별 선언은 tokens/catalog.json, 전체 제품 근거는 design 색인에서 조회합니다.'};
  }
  let design;
  if (manifest.designIndex) {
    const index = JSON.parse(await readFile(resolve(packageRoot, manifest.designIndex), 'utf8'));
    if (index.version !== pkg.version) throw new Error('디자인 색인과 패키지 버전이 일치하지 않습니다.');
    design = {guide:index.guide,details:index.details,sourceRevision:index.sourceRevision,coverage:index.coverage,
      groups:index.groups.filter(matches),
      foundations:index.foundations.filter(item=>matches({...item,categoryLabel:index.categories.find(category=>category.id===item.category)?.label})).map(({group,label,token,value,resolved})=>({group,label,token,value,resolved})),
      references:index.components.filter(matches).map(({file,label,portable,status})=>({file,label,portable,status})),
      note:'선언별 선택자·미디어 조건·줄 번호는 details에서 필요한 항목만 조회하세요. 선언 목록은 최종 계산 스타일이 아닙니다.'};
  }
  if (summary) {
    let projectPackage = {};
    try {projectPackage = JSON.parse(await readFile(resolve(directory,'package.json'),'utf8'));}
    catch(error) {if(error.code !== 'ENOENT') throw error;}
    console.log(JSON.stringify({packageRoot,version:pkg.version,
      project:{directory,packageManager:projectPackage.packageManager||null,scripts:projectPackage.scripts||{}},
      docs:['docs/IDENTITY.md','docs/COMPONENTS.md',library?.guide,library?.feedback?.guide,library?.tables?.guide].filter(Boolean),
      portableApis:manifest.portable.map(item=>item.name),
      templates:library?.templates.map(({id,label})=>({id,label})),
      contracts:{tables:library?.tables?.contract,feedback:library?.feedback?.contract},
      tokens:manifest.tokenCatalog,design:manifest.designIndex,
      lookup:'Replace --summary with a keyword to find matching props, tokens, examples and behavior. Paths are relative to packageRoot.',
      boundary:'Import only portableApis. Reference product modules may require application dependencies.',
    },null,2));
  } else console.log(JSON.stringify({packageRoot, version:pkg.version, query,
    docs:['docs/IDENTITY.md','docs/COMPONENTS.md','docs/PATTERNS.md','agent/INSTRUCTIONS.md'],
    components, actions:(manifest.actions || []).filter(matches), icons:(manifest.icons || []).filter(matches), library, design,
    ...(manifest.actions ? {} : {note:'이전 버전은 아이콘·액션 목록을 제공하지 않습니다. src/ActionButton.jsx와 src/Icon.jsx에서 확인하세요.'}),
  }, null, 2));
} catch (error) {
  console.error('CX 조회 실패: ' + error.message);
  process.exitCode = 1;
}
