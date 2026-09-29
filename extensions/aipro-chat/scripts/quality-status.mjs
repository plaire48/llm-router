import {readFile, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {verificationInputs} from './verification-inputs.mjs';
import {stageOutcome} from './verification-stage.mjs';
import {QUALITY_BASELINE, QUALITY_ONCE, QUALITY_PROFILE} from './browser-verification-plan.mjs';

const once = new Set(QUALITY_ONCE);
const gates = ['unit', 'design', 'candidate-build'];
function fullStageSelection(report) {
  const selection = report.selection;
  if (report.fullMatrix !== true || !Array.isArray(selection) || !selection.length || new Set(selection).size !== selection.length ||
      selection.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name) || gates.includes(name)) ||
      QUALITY_BASELINE.some(name => !selection.includes(name))) return false;
  const names = new Set(report.stages.map(stage => stage.name));
  const declared = new Set(gates);
  for (const suite of selection) {
    const repeated = [1,2,3].map(n => `${suite}-${n}`);
    const single = names.has(suite), completeRepeat = repeated.every(name => names.has(name));
    // A suite is either once or all three repetitions, never a mixture or a
    // partial repetition. Required baseline frequencies are checked separately.
    if (single === completeRepeat || single && repeated.some(name => names.has(name))) return false;
    for (const name of single ? [suite] : repeated) {
      if (declared.has(name)) return false;
      declared.add(name);
    }
  }
  return declared.size === names.size && [...names].every(name => declared.has(name));
}
export function currentQualityReport(reports, inputs) {
  const expected = [...gates, ...QUALITY_BASELINE.flatMap(name => once.has(name) ? [name] : [1,2,3].map(n=>`${name}-${n}`))];
  const time = r => Date.parse(r.startedAt || r.finishedAt);
  const matching = reports.filter(({report:r}) => isDeepStrictEqual(r?.inputSha256, inputs));
  const latest = matching.filter(({report:r}) => [QUALITY_PROFILE, 'full'].includes(r.profile))
    .sort((a,b)=>time(b.report)-time(a.report))[0];
  if (!latest || !Number.isFinite(time(latest.report))) return null;
  // A new run of this same candidate can uncover a failure. Do not hide it by
  // selecting an older pass, including while the new verification is running.
  if (matching.some(({report:r}) => !Number.isFinite(time(r)) || time(r) >= time(latest.report) &&
      (r.status !== 'passed' || !Array.isArray(r.stages) || !r.stages.length || r.stages.some(stage => stageOutcome(stage) !== 'passed') ||
        new Set(r.stages.map(stage => stage.name)).size !== r.stages.length))) return null;
  return [latest].filter(({report:r}) => {
    if (r?.status !== 'passed' || r.repeats !== 3 || r.evidence?.actualBrowser !== true ||
        !isDeepStrictEqual(r.inputSha256, inputs) || !Array.isArray(r.stages) || !Number.isFinite(Date.parse(r.finishedAt)) ||
        Date.parse(r.finishedAt) < time(r) || r.releaseBlockers?.length ||
        r.stages.some(stage => stageOutcome(stage) !== 'passed' || typeof stage.name !== 'string') ||
        new Set(r.stages.map(stage => stage.name)).size !== r.stages.length) return false;
    // Never merge separate reports, or count duplicate/unfinished stages as coverage.
    const coverage = expected.every(name => {
      const stages = r.stages.filter(s=>s.name===name);
      return stages.length===1 && stageOutcome(stages[0])==='passed';
    });
    return coverage && (r.profile === QUALITY_PROFILE ? r.stages.length === expected.length : fullStageSelection(r));
  }).sort((a,b)=>Date.parse(b.report.finishedAt)-Date.parse(a.report.finishedAt))[0] || null;
}
const checksCatalog = new Set(['unit','design','candidate-build',...QUALITY_BASELINE]);
const stageNames = check => once.has(check) || !QUALITY_BASELINE.includes(check) ? [check] : [1,2,3].map(n=>`${check}-${n}`);
export function qualityWorkStatus(work, reports, inputs) {
  if (work?.schemaVersion !== 2 || !Array.isArray(work.items) || !work.items.length) throw new Error('quality_work_invalid');
  const current = currentQualityReport(reports, inputs);
  const ids = new Set(), orders = new Set();
  const items = work.items.map(item => {
    if (!item.id || ids.has(item.id) || !Number.isInteger(item.order) || item.order < 1 || orders.has(item.order) ||
        !['implemented','pending','external','not_selected'].includes(item.state) ||
        typeof item.title!=='string' || !item.title.trim() || typeof item.acceptance!=='string' || !item.acceptance.trim() ||
        typeof item.nextAction!=='string' || !item.nextAction.trim() || !Array.isArray(item.checks) ||
        new Set(item.checks).size!==item.checks.length || item.checks.some(check=>!checksCatalog.has(check)) ||
        (['implemented','pending'].includes(item.state) ? !item.checks.length : item.checks.length>0)) throw new Error('quality_work_invalid');
    ids.add(item.id); orders.add(item.order);
    const evidenceStages=item.checks.flatMap(stageNames).map(name=>({name,
      status:current ? stageOutcome(current.report.stages.find(stage=>stage.name===name)) : 'unverified',
      log:current ? current.path.replace(/report\.json$/,`${name}.log`) : null}));
    return {...item, evidenceStages, verification: item.state==='implemented' ? (current ? 'current_core_passed' : 'needs_current_core') : 'not_claimed'};
  }).sort((a,b)=>a.order-b.order);
  const counts=Object.fromEntries(['implemented','pending','external','not_selected'].map(state=>[state,items.filter(item=>item.state===state).length]));
  const selected=items.length-counts.not_selected;
  const progress={basis:'tracked_items_not_product_readiness',total:items.length,selected,...counts,
    implementationPercent:selected ? Math.round(counts.implemented/selected*1000)/10 : null,
    currentCoreVerified:current ? counts.implemented : null};
  return {schemaVersion:2, scope:'browser-extension', currentCoreReport:current?.path || null,
    actualModelQuality:null, releaseApproved:false, progress, items,
    blocked:items.filter(item=>item.state==='external').map(({id,nextAction})=>({id,nextAction})),
    next:items.find(item=>item.state==='pending')?.id || (items.some(item=>item.verification==='needs_current_core')?'verify:quality':null)};
}
const cell = value => String(value).replaceAll('|','\\|').replace(/\r?\n/g,' ');
export function qualityWorkMarkdown(status) {
  const labels={implemented:'구현',pending:'개발 대기',external:'외부 조건 대기',not_selected:'비채택'};
  return '# 브라우저 누비 품질 작업표\n\n' +
    `등록 항목 구현율: ${status.progress.implementationPercent ?? '해당 없음'}% (${status.progress.implemented}/${status.progress.selected}). 비채택 ${status.progress.not_selected}개 제외. 작업량 가중치, 제품 준비도나 실모델 성공률이 아니다.\n\n` +
    `동일 후보 핵심 검증: ${status.currentCoreReport || '미검증'}. 실제 모델 정확도는 미측정이다.\n\n` +
    '| 순서 / ID | 항목 | 상태 | 연결 검사 | 다음 행동 |\n| --- | --- | --- | --- | --- |\n' +
    status.items.map(item=>`| ${item.order} / ${cell(item.id)} | ${cell(item.title)} | ${labels[item.state]} / ${item.verification==='current_core_passed'?'핵심 회귀 통과':item.state==='implemented'?'현재 후보 미검증':'완료 아님'} | ${cell(item.checks.join(', ') || '실환경/도입 조건 별도')} | ${cell(item.nextAction)} |`).join('\n') +
    '\n\n연결 검사는 해당 항목의 핵심 회귀 근거다. 개별 세부 기능 전부나 실서비스 성공을 입증하지 않는다. 단계별 로그는 quality:status -- --json의 evidenceStages에서 확인한다.\n';
}

async function main() {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const work=JSON.parse(await readFile(resolve(root,'quality-work.json'),'utf8'));
  const inputs=await verificationInputs(root), reports=[], unreadable=[];
  for(const entry of await readdir(resolve(root,'verification'),{withFileTypes:true})) {
    if(!entry.isDirectory() || !entry.name.startsWith('pre-release-'))continue;
    const path=`verification/${entry.name}/report.json`;
    try {reports.push({path,report:JSON.parse(await readFile(resolve(root,path),'utf8'))});}
    catch {unreadable.push(path);}
  }
  const status={...qualityWorkStatus(work,reports,inputs),unreadableReports:unreadable};
  if(process.argv.includes('--markdown'))console.log(qualityWorkMarkdown(status));
  else if(process.argv.includes('--json'))console.log(JSON.stringify(status,null,2));
  else {
    console.log(`등록 항목 구현율: ${status.progress.implementationPercent ?? '해당 없음'}% (${status.progress.implemented}/${status.progress.selected}), 비채택 ${status.progress.not_selected}개 제외. 제품 완성률이나 실모델 성공률이 아닙니다.`);
    console.log(`현재 소스의 핵심 검증: ${status.currentCoreReport || '없음 — npm run verify:quality 필요'}`);
    console.table(status.items.map(({id,title,state,verification})=>({id,title,state,verification})));
    console.log('실모델 품질 미측정. 외부 조건 대기와 비채택은 구현 완료가 아닙니다.');
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
