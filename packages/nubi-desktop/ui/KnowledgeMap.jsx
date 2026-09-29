import React,{useEffect,useRef,useState} from 'react';
import {ActionButton,CxButton,CxInput,CxSelect,CxNotice} from '@e2e/cx-design-system';
import {DeckDisclosure,DeckStatus} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';

const kinds={concept:'업무 개념',source:'소스',wiki:'Wiki',requirement:'요구사항',document:'문서',database:'DB',table:'테이블',column:'컬럼'};
const origins={declared:'목록에 선언',sql:'DDL에서 추출',database:'DB에서 수집',imported:'가져온 메타데이터'};
const relationLabels={broader:'상위 개념',related:'관련 개념',implements:'구현',documents:'설명',reads:'조회',writes:'기록',represents:'표현',validates:'검증 대상',contains:'포함',references:'외래 키 참조'};
const issues={catalog_invalid:'지식 목록의 형식을 확인해 주세요.',catalog_unreadable:'지식 목록을 읽을 수 없어요.',source_unavailable:'연결한 원본 파일을 읽을 수 없어요.',schema_parse_failed:'SQL을 해석하지 못했어요. 선택한 DB 문법을 확인해 주세요.',schema_snapshot_required:'현재 구조의 CREATE TABLE 파일이 필요해요. 마이그레이션은 재생하지 않습니다.',schema_unsupported:'지원하지 않는 스키마 구문이 있어요.',schema_unreadable:'스키마 파일을 읽지 못했거나 64KB를 넘었어요.',schema_timeout:'스키마 읽기 시간이 초과됐어요.',schema_duplicate_or_limit:'중복 정의 또는 관계 지도의 크기 제한을 확인해 주세요.',relation_unresolved:'연결 대상이 없어 일부 관계를 표시하지 못했어요.',relation_invalid:'관계의 종류와 방향을 확인해 주세요.',relation_self:'자기 자신을 가리키는 관계가 있어요.',foreign_key_unresolved:'참조하는 테이블 또는 컬럼을 확인할 수 없어요.',concept_cycle:'상위 개념이 순환해 해당 관계를 제외했어요.',changed_during_scan:'읽는 중 원본이 바뀌었어요. 다시 읽어 주세요.',database_unavailable:'DB 파일을 열지 못했어요.',database_not_connected:'DB를 연결하면 관계를 확인할 수 있어요.',database_schema_scope:'연결한 스키마와 지식 목록의 스키마가 달라요.',database_relation_partial:'원격 DB의 복합 외래 키, 뷰, 트리거는 수집하지 않았어요.',database_objects_excluded:'뷰와 가상 테이블 등 일부 DB 객체는 제외했어요.',metadata_invalid:'메타데이터 파일의 형식을 확인해 주세요.',schema_limit:'스키마 수집 범위가 너무 커요. 범위를 줄여 주세요.'};
const dbErrors={database_connection_failed:'DB에 연결하지 못했어요. 주소와 계정, 접근 권한, 인증서를 확인해 주세요.',database_timeout:'DB 응답을 기다리다 중단했어요. 연결 상태를 확인해 주세요.',database_config_invalid:'DB 연결 정보를 확인해 주세요.',database_schema_scope:'MySQL은 DB 이름, Oracle은 로그인 사용자의 대문자 이름을 스키마로 입력해 주세요.',schema_limit:'현재 스키마가 수집 범위를 넘었어요. 테이블 100개 이하의 범위로 연결해 주세요.',database_busy:'DB를 읽고 있어요. 잠시 기다려 주세요.'};
const engineLabels={postgres:'PostgreSQL',mysql:'MySQL',mariadb:'MariaDB',sqlserver:'SQL Server',oracle:'Oracle'};
const ports={postgres:5432,mysql:3306,mariadb:3306,sqlserver:1433,oracle:1521};

export function KnowledgeMap({api,taskId,openPath,onError,onNotice}){
  const [map,setMap]=useState(null),[query,setQuery]=useState(''),[focus,setFocus]=useState(''),[packet,setPacket]=useState(null),[busy,setBusy]=useState(false),[dbOpen,setDbOpen]=useState(false);
  const alive=useRef(true),sequence=useRef(0),lock=useRef(false);
  useEffect(()=>{alive.current=true;refresh();return()=>{alive.current=false;sequence.current++;};},[taskId]);
  async function refresh(){const ticket=++sequence.current;try{const value=await api('knowledgeMap',{taskId});if(alive.current&&ticket===sequence.current){setMap(value);setPacket(null);setFocus('');}}catch{if(alive.current)onError('관계 지도를 읽지 못했어요. 다시 시도해 주세요.');}}
  async function act(fn){if(lock.current)return;lock.current=true;setBusy(true);try{await fn();}catch(e){onError(e.message==='source_stale'?'원본이 바뀌었어요. 관계를 새로고침한 뒤 기록해 주세요.':'관계 지도를 처리하지 못했어요. 입력과 원본을 확인해 주세요.');}finally{lock.current=false;if(alive.current)setBusy(false);}}
  async function select(id){const ticket=++sequence.current;setFocus(id);setPacket(null);try{const value=await api('knowledgeQuery',{taskId,focusId:id,depth:2});if(alive.current&&ticket===sequence.current)setPacket(value);}catch{if(alive.current)onError('항목이 바뀌었어요. 관계를 새로고침해 주세요.');}}
  const matches=(map?.nodes||[]).filter(n=>[n.label,n.id,...(n.aliases||[])].some(v=>v.toLowerCase().includes(query.toLowerCase()))).slice(0,40);
  if(focus&&!matches.some(n=>n.id===focus)){const current=map?.nodes.find(n=>n.id===focus);if(current)matches.unshift(current);}
  const selected=packet?.nodes.find(n=>n.id===focus),byId=new Map(packet?.nodes.map(n=>[n.id,n])||[]);
  const direct=packet?.edges.filter(e=>e.from===focus||e.to===focus)||[];
  return <section className="nubi-map" aria-label="프로젝트 관계">
    <div className="nubi-map-heading"><h2>프로젝트 관계</h2><ActionButton action="refresh" label="관계 새로고침" disabled={busy} onClick={()=>act(refresh)}/></div>
    <p className="nubi-muted">업무에서 연결된 코드와 DB, Wiki를 찾으세요.</p>
    <div className="nubi-task-actions"><CxButton onClick={()=>setDbOpen(!dbOpen)} aria-expanded={dbOpen}>DB 연결</CxButton><CxButton disabled={busy} onClick={()=>act(async()=>{const file=map?.configured?{path:map.catalogPath}:await api('initializeKnowledgeCatalog',{taskId});await openPath(file.path,taskId);await refresh();})}>{map?.configured?'지식 목록 편집':'지식 목록 만들기'}</CxButton>{!!map?.nodes.length&&<CxButton disabled={busy} onClick={()=>act(async()=>{await api('exportKnowledgeMap',{taskId,expectedFingerprint:map.fingerprint});await refresh();onNotice('관계 지도를 Wiki에 저장했어요.');})}>관계를 Wiki에 기록</CxButton>}{map?.baselinePath&&<ActionButton action="read" label="관계 기록 열기" onClick={()=>act(()=>openPath(map.baselinePath,taskId))}/>}</div>
    {dbOpen&&<DatabaseConnections api={api} onChanged={refresh}/>}
    {!map&&<p role="status" className="nubi-muted">연결된 근거를 읽고 있어요.</p>}
    {map&&!map.nodes.length&&<p className="nubi-muted">DB를 연결하거나 지식 목록에 자료를 추가해 주세요.</p>}
    {!!map?.nodes.length&&<>
      <div className="nubi-map-controls"><label>연결된 항목 찾기<CxInput aria-label="관계 항목 찾기" value={query} onChange={e=>setQuery(e.target.value)} placeholder="고객, 주문, 테이블 이름…"/></label><label>확인할 항목<CxSelect aria-label="관계 중심 항목" value={focus} onChange={e=>e.target.value&&select(e.target.value)}><option value="">항목을 선택하세요</option>{matches.map(n=><option value={n.id} key={n.id}>{n.label} ({kinds[n.kind]})</option>)}</CxSelect></label></div>
      <div className="nubi-map-meta nubi-muted"><span>항목 {map.nodes.length}개</span><span>관계 {map.edges.length}개</span><span>{new Date(map.generatedAt).toLocaleTimeString('ko-KR')} 확인</span>{map.nodes.some(n=>n.change==='changed')&&<span>Wiki 기록 이후 원본 변경</span>}</div>
      {selected&&<div className="nubi-map-focus"><div><DeckStatus>{kinds[selected.kind]}</DeckStatus><strong>{selected.label}</strong><small>{origins[selected.origin]}{selected.dataType?` (${selected.dataType})`:''}{selected.primary?', 기본 키':''}</small></div>{selected.path&&<ActionButton action="read" label="원본 열기" onClick={()=>act(()=>openPath(selected.path,taskId))}/>}{selected.description&&<p>{selected.description}</p>}{selected.change==='changed'&&<p>Wiki 기록 이후 근거가 바뀌었어요.</p>}{selected.evidence?.filter(e=>e.collectedAt).map(e=><small key={e.resource}>DB 수집 시점: {new Date(e.collectedAt).toLocaleString('ko-KR')}</small>)}</div>}
      {selected&&<><ul className="nubi-map-relations" aria-label="직접 연결된 관계">{direct.map(e=><li key={e.id}><CxButton onClick={()=>select(e.from)}>{byId.get(e.from)?.label}</CxButton><span>→ {relationLabels[e.type]} →<small>{origins[e.origin]}</small></span><CxButton onClick={()=>select(e.to)}>{byId.get(e.to)?.label}</CxButton></li>)}</ul>{!direct.length&&<p className="nubi-muted">아직 연결한 관계가 없어요.</p>}<DeckDisclosure title="함께 확인할 항목"><p className="nubi-muted">등록된 관계를 기준으로 찾았습니다. 실제 영향은 테스트로 확인해 주세요.</p>{packet.nodes.filter(n=>n.id!==focus).map(n=><CxButton className="nubi-file-link" key={n.id} onClick={()=>select(n.id)}>{n.label} ({kinds[n.kind]})</CxButton>)}{packet.truncated&&<p>일부 연결만 표시했어요. 다른 항목을 선택해 더 확인하세요.</p>}</DeckDisclosure></>}
    </>}
    {map?.comparisons?.map(c=><DeckDisclosure key={c.id} title={`스키마 대조: ${c.state==='different'?`${c.changes.length}개 차이`:c.state==='unavailable'?'확인 불가':'확인 범위 일치'}`}><p className="nubi-muted">{c.baseline} → {c.id}<br/>테이블, 컬럼, 자료형, 기본 키를 비교합니다.</p>{c.changes.map((d,i)=><p key={i}>{d.table}{d.column?` / ${d.column}`:''} — {({table_missing:'테이블 없음',table_added:'테이블 추가',column_missing:'컬럼 없음',column_added:'컬럼 추가',column_changed:'정의 변경'})[d.type]}</p>)}</DeckDisclosure>)}
    {!!map?.diagnostics.length&&<DeckDisclosure title={`수집 범위와 확인 사항 ${map.diagnostics.length}개`}>{map.diagnostics.map((d,i)=><p className="nubi-muted" key={i}>{issues[d.code]||'수집 범위를 확인해 주세요.'}<br/><small>{d.path}{d.detail?': '+d.detail:''}</small></p>)}</DeckDisclosure>}
  </section>;
}

function DatabaseConnections({api,onChanged}){
  const [connections,setConnections]=useState([]),[form,setForm]=useState({id:'project-db',engine:'postgres',host:'localhost',port:5432,database:'',schema:'public',user:'',password:'',tls:true}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[statusError,setStatusError]=useState('');
  const alive=useRef(true),lock=useRef(false),statusRevision=useRef(0);
  async function readStatus(processed=false){const revision=++statusRevision.current;try{const state=await api('databaseConnection');if(alive.current&&revision===statusRevision.current){setConnections(state.connections);setStatusError('');}}catch{if(alive.current&&revision===statusRevision.current)setStatusError(processed?'요청은 처리됐지만 연결 목록을 갱신하지 못했어요.':'연결 상태를 확인하지 못했어요.');}}
  useEffect(()=>{alive.current=true;void readStatus();return()=>{alive.current=false;statusRevision.current++;};},[]);
  async function retryStatus(){if(lock.current)return;lock.current=true;setBusy(true);try{await readStatus();}finally{lock.current=false;if(alive.current)setBusy(false);}}
  const update=(key,value)=>setForm(f=>({...f,[key]:value}));
  async function run(action,id){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
    const {id:unused,...input}=form;input.host=input.host.trim();input.database=input.database.trim();input.user=input.user.trim();input.schema=['mysql','mariadb'].includes(input.engine)?input.database:input.engine==='oracle'?input.user.toUpperCase():input.schema.trim();statusRevision.current++;const receipt=await api('databaseConnection',{action,id,input:action==='connect'?input:undefined});
    if(!alive.current)return;setForm(f=>({...f,password:''}));
    if(action==='disconnect')setConnections(current=>current.filter(c=>c.id!==id));
    else setConnections(current=>[...current.filter(c=>c.id!==id),{id,engine:action==='connect'?input.engine:current.find(c=>c.id===id)?.engine,schema:action==='connect'?input.schema:current.find(c=>c.id===id)?.schema,tables:receipt.tables,collectedAt:receipt.collectedAt}]);
    await readStatus(true);await onChanged();
  }catch(e){if(alive.current)setError(dbErrors[e.message]||'DB 정보를 읽지 못했어요. 연결 정보를 확인해 주세요.');}finally{lock.current=false;if(alive.current)setBusy(false);}}
  return <div className="nubi-db-connect"><p className="nubi-muted">테이블 구조만 읽습니다. 접속 정보는 앱을 닫으면 사라집니다.</p>{connections.map(c=><div className="nubi-db-connected" key={c.id}><span><strong>{c.id}</strong> ({engineLabels[c.engine]})<small>{c.tables}개 테이블<br/>{new Date(c.collectedAt).toLocaleTimeString('ko-KR')} 수집</small></span><ActionButton action="refresh" label="DB 다시 읽기" disabled={busy} onClick={()=>run('refresh',c.id)}/><CxButton disabled={busy} onClick={()=>run('disconnect',c.id)}>연결 해제</CxButton></div>)}
    {statusError&&<div><CxNotice tone="danger">{statusError}</CxNotice><CxButton type="button" disabled={busy} onClick={retryStatus}>연결 상태 다시 확인</CxButton></div>}
    <form aria-label="DB 연결 정보" onSubmit={e=>{e.preventDefault();run('connect',form.id);}} onInvalidCapture={e=>{const details=e.target.closest('details');if(details)details.open=true;}}>
      <div className="nubi-db-fields">
        <label>DB 종류<CxSelect aria-label="DB 종류" disabled={busy} value={form.engine} onChange={e=>{const engine=e.target.value;setForm(f=>({...f,engine,port:ports[engine],schema:engine==='postgres'?'public':engine==='sqlserver'?'dbo':''}));}}>{Object.entries(engineLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</CxSelect></label>
        <label>서버 주소<CxInput aria-label="서버 주소" required disabled={busy} autoComplete="off" spellCheck={false} value={form.host} onChange={e=>update('host',e.target.value)} placeholder="예: db.company.local"/></label>
        <label>{form.engine==='oracle'?'서비스 이름':'DB 이름'}<CxInput aria-label={form.engine==='oracle'?'서비스 이름':'DB 이름'} required disabled={busy} autoComplete="off" value={form.database} onChange={e=>update('database',e.target.value)} placeholder={form.engine==='oracle'?'예: ORCL':'예: project'}/></label>
        <label>사용자<CxInput aria-label="사용자" required disabled={busy} autoComplete="off" value={form.user} onChange={e=>update('user',e.target.value)} placeholder="접속 계정"/></label>
        <label>비밀번호<CxInput aria-label="비밀번호" type="password" disabled={busy} autoComplete="off" value={form.password} onChange={e=>update('password',e.target.value)}/></label>
      </div>
      <details className="deck-subsection nubi-db-options"><summary>연결 옵션</summary>
        <div className="nubi-db-fields">
          <label>연결 ID<CxInput aria-label="연결 ID" required disabled={busy} pattern={String.raw`[a-zA-Z0-9_\-]{1,80}`} title="영문, 숫자, 밑줄, 하이픈을 사용해 주세요." value={form.id} onChange={e=>update('id',e.target.value)}/></label>
          <label>포트<CxInput aria-label="포트" type="number" required min={1} max={65535} disabled={busy} value={form.port} onChange={e=>update('port',e.target.value===''?'':Number(e.target.value))}/></label>
          {['postgres','sqlserver'].includes(form.engine)&&<label>스키마<CxInput aria-label="스키마" required disabled={busy} value={form.schema} onChange={e=>update('schema',e.target.value)}/></label>}
        </div>
        <label className="nubi-db-tls"><input type="checkbox" disabled={busy} checked={form.tls} onChange={e=>update('tls',e.target.checked)}/> TLS 암호화 연결</label>
        <small className="nubi-muted">포트와 스키마는 DB 기본값을 사용합니다. 다른 설정이 필요한 경우에만 바꾸세요.</small>
      </details>
      {error&&<CxNotice tone="danger">{error}</CxNotice>}
      <CxButton type="submit" variant="primary" busy={busy} disabled={busy}>{busy?'DB 구조 읽는 중':'연결해서 읽기'}</CxButton>
    </form>
    <small className="nubi-muted">SQLite와 메타데이터 JSON은 지식 목록에서 연결하세요.</small>
  </div>;
}
