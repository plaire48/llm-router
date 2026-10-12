// What the OpenWiki update card shows. Text only: no input, no state.
const FRESHNESS={source_changed:'원본이 바뀜',unavailable:'원본이 없음',document_changed:'페이지가 직접 바뀜'};
const CHANGE={modified:'수정',added:'추가',deleted:'삭제'};
const STAGE={planning:'계획',replanning:'계획 다시 세움',generating:'페이지 작성',finalizing:'마무리',noop:'바뀐 페이지 없음'};
const ERROR={model_unavailable:'모델에 연결되어 있지 않아 갱신하지 못했어요. 로그인 상태를 확인해 주세요.',wiki_update_failed:'갱신을 마치지 못했어요. 작업 공간은 그대로입니다.',wiki_update_interrupted:'갱신이 중간에 멈췄어요. 앱이 종료되었거나 프로젝트가 바뀌었어요. 작업 공간은 그대로이니 다시 갱신해 주세요.'};
const day=value=>value?String(value).slice(0,10):'알 수 없음';

export function wikiUpdateView({status,update,initialization}){
  if(update?.state==='running'){
    const last=[...(update.events||[])].reverse().find(event=>event.type==='progress');
    const stage=last?(STAGE[last.stage]||last.stage)+(last.index&&last.total?` ${last.index}/${last.total}`:'')+(last.page?`: ${last.page}`:''):'준비';
    return {title:'위키 갱신 중',lines:[stage,'작업 공간의 복사본에서 실행합니다. 끝나면 결과를 확인하고 반영합니다.'],pages:[],actions:['cancel']};
  }
  if(update?.state==='ready'){
    const pages=(update.changes||[]).filter(change=>change.path.endsWith('.md')).map(change=>({path:change.path,label:CHANGE[change.change]||change.change}));
    const lines=[pages.length?`바뀐 페이지 ${pages.length}개를 반영할 수 있어요.`:'바뀐 페이지가 없어요.'];
    if(update.result?.skipped)lines.push('위키가 다시 쓸 페이지가 없다고 판단했어요. 갱신 기록만 바뀌었어요.');
    if(update.outside?.length)lines.push('반영하지 않는 파일: '+update.outside.join(', '));
    if(update.outsideEvidence?.length)lines.push('반영하지 않는 파일을 근거로 인용한 페이지가 있어요. 반영하면 이 근거는 확인하지 않는 상태로 남아요: '+update.outsideEvidence.map(item=>`${item.page}(${item.path})`).join(', '));
    return {title:'위키 갱신 결과',lines,pages,actions:update.changes?.length?['apply','discard']:['discard']};
  }
  const ended={applied:`${update?.changes?.length||0}개 파일을 반영했어요.`,cancelled:'갱신을 멈췄어요. 작업 공간은 그대로입니다.',discarded:'갱신 결과를 버렸어요. 작업 공간은 그대로입니다.',failed:ERROR[update?.error]||ERROR.wiki_update_failed};
  const notice=update&&ended[update.state]?[ended[update.state]]:[];
  if(status?.reason==='no_wiki_pages'){
    const state=initialization?.state;
    const line=state==='running'?'위키를 만들고 있어요. 완료되면 문서가 여기에 표시돼요.':state==='attention'?'위키 생성이 중단됐어요. 오류를 확인한 뒤 다시 시도해 주세요.':state==='cancelled'?'위키 생성을 중지했어요. 다시 시도할 수 있어요.':state==='waiting_model'?'모델을 연결하면 위키를 만들 수 있어요.':'아직 위키가 생성되지 않았어요.';
    return {title:'위키 문서',lines:[...notice,line],pages:[],actions:[]};
  }
  if(!status||status.state==='unknown')return {title:'위키 갱신',lines:[...notice,'이 위키는 생성 기록이 없어 갱신을 제안하지 않아요.'],pages:[],actions:[]};
  if(status.state==='current')return {title:'위키가 최신이에요',lines:[...notice,`마지막 갱신: ${day(status.lastUpdate?.updatedAt)}`],pages:[],actions:[]};
  const lines=[...notice,`마지막 갱신: ${day(status.lastUpdate?.updatedAt)}. 마지막 갱신 뒤 바뀐 파일 ${status.changedFiles?.length||0}개.`];
  if(status.reason==='no_generation_record')lines[notice.length]='기존 위키를 읽고 갱신 기록을 복구합니다.';
  if(status.sourceMode==='folder')lines.push('현재 폴더의 저장된 파일로 갱신합니다.');
  if(status.reason==='interrupted')lines.push('지난 갱신이 중간에 멈췄어요.');
  if(status.uncommitted?.length)lines.push(`커밋하지 않은 변경 ${status.uncommitted.length}개도 현재 파일 그대로 갱신에 들어가요.`);
  lines.push('갱신은 로그인한 모델로 실행하며 저장소 내용이 모델에 전달됩니다. 계획 한 번과 페이지마다 여러 번 모델을 부릅니다. 결과를 확인한 뒤에 반영합니다.');
  return {title:'위키 갱신 제안',lines,pages:(status.stalePages||[]).map(page=>({path:page.path,label:FRESHNESS[page.freshness]||page.freshness})),actions:['run']};
}
