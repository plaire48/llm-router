import {stageOutcome} from './verification-stage.mjs';
// Regression evidence, not a score for real-model capability or production readiness.
export const QUALITY_AREAS = [
  {id: 'requirements', name: '요구사항과 질문', suites: ['form-workflow-browser', 'clarification-browser']},
  {id: 'planning', name: '계획과 방향 변경', suites: ['task-plan-browser', 'agent-input-browser']},
  {id: 'tools', name: '도구 선택과 인자', suites: ['harness-repair-browser', 'script-preflight-browser']},
  {id: 'interaction', name: '화면 이해와 조작', suites: ['page-information-browser', 'toggle-recovery-browser', 'hover-links-browser']},
  {id: 'recovery', name: '오류 복구와 실행 유지', suites: ['error-recovery-browser', 'background-lifetime-browser']},
  {id: 'context', name: '컨텍스트와 지식', suites: ['context-browser', 'document-retrieval-browser', 'browser-wiki-browser']},
  {id: 'delegation', name: '하위 분석과 결과 전달', suites: ['role-agents-browser', 'analysis-delivery-browser']},
  {id: 'verification', name: '결과 검증과 승인', suites: ['completion-review-browser', 'popup-approval-browser']},
];

export function qualityScorecard(report) {
  const areas = QUALITY_AREAS.map(area => {
    const trials = area.suites.flatMap(suite => Array.from({length: 3}, (_, index) => {
      const name = `${suite}-${index + 1}`;
      const records = (report.stages || []).filter(stage => stage.name === name);
      // Duplicate or unfinished records cannot prove a passed trial.
      return {name, status: records.length !== 1 ? 'missing' : stageOutcome(records[0])};
    }));
    const passed = trials.filter(trial => trial.status === 'passed').length;
    const failed = trials.filter(trial => trial.status === 'failed').length;
    const missing = trials.length - passed - failed;
    return {...area, passed, failed, missing, total: trials.length,
      score: missing ? null : Math.round(100 * passed / trials.length), trials};
  });
  const gatesPassed=report.status==='passed' && ['unit','design','candidate-build'].every(name=>report.stages?.filter(stage=>stage.name===name).length===1 && stageOutcome(report.stages.find(stage=>stage.name===name))==='passed');
  return {version: 4, type: 'synthetic-browser-regression',
    evidence: report.evidence || {}, sourceStatus: report.status,
    buildSha256: report.buildSha256, archiveSha256: report.archiveSha256,
    modelCapabilityScore: null, liveAccountVerified: false,
    complete: areas.every(area => area.missing === 0),
    gatesPassed,
    areas};
}

export function qualityMarkdown(card) {
  return '# 브라우저 하네스 회귀 평가\n\n' +
    '실제 Chrome과 합성 모델/페이지로 검사한 계약 준수 결과입니다. 실제 Qwen의 업무 성공률이나 배포 승인 점수가 아닙니다. 각 시나리오는 새 프로필로 3회 검사합니다.\n\n' +
    '| 영역 | 통과 / 계획 | 실패 | 미검증 | 회귀 점수 |\n| --- | --- | --- | --- | --- |\n' +
    card.areas.map(area => `| ${area.name} | ${area.passed}/${area.total} | ${area.failed} | ${area.missing} | ${area.score === null ? '미산정' : area.score + '/100'} |`).join('\n') +
    `\n\n단위 검사·디자인·빌드: ${card.gatesPassed ? '통과' : '미완료 또는 실패'}. 원본 검증 상태: ${card.sourceStatus}.\n\n` +
    '임의의 종합 품질 점수는 산출하지 않습니다. 공개 벤치마크 점수와 자체 회귀 결과를 합산하지 않습니다.\n\n' +
    '미실행/중단/중복 기록은 통과로 합산하지 않습니다. 일부 통과만으로 영역 점수를 산정하지 않습니다. 모든 영역의 회귀 점수가 높아도 사내 업무 성공률, 모델 정확도, SSO 실계정 검증은 별도입니다.\n';
}
