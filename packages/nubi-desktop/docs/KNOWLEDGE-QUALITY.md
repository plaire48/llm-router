# 요구사항·소스·DB·OpenWiki를 연결하는 변경 품질

## 이번에 적용한 흐름

`원래 요청과 AC → 필요한 결정 질문 → 출처 조회 → 변경 계획 → 작은 변경 제안 → 사용자 반영 → 실행·화면 확인 → Wiki 근거 기록`

모델이 설명을 잘 썼다는 사실을 성공 판정으로 사용하지 않습니다. 요구사항, 사람이 답한 결정, 변경할 파일, 파일을 읽은 버전, 검증 방법, 실제 실행 결과를 각각 보존합니다. 현재 구현은 계획과 변경 범위를 검사하고 실제 결과를 검토할 수 있게 하는 단계입니다. 사내 모델의 정확도가 향상됐다는 측정 결과는 아직 없습니다.

### 요구사항과 HITL

- `ask_user`는 구현 범위·업무 의미·완료 조건을 바꾸는 결정 하나를 묻습니다. 기존 누비의 `textQuestionArgs`, `makeQuestion`, `questionAnswer`, `QuestionForm`을 직접 재사용합니다. 2~4개 선택지와 자유 입력·긴 답변을 제공합니다.
- 답변 초안·질문 ID·선택지·최종 답변을 같은 작업에 저장합니다. 새로고침 후 이어지고, 오래된 질문 응답과 중복 응답을 거부합니다. 답이 없는 질문을 일반 분석 재시작이나 후속 입력으로 건너뛰지 않습니다.
- 질문과 최종 반영 승인은 별개입니다. 질문은 추가 정보 수집이며, 기존 diff·사용자 반영·실제 파일 readback 경계는 유지합니다.
- `record_change_plan`은 원래 완료 조건 모두를 요구사항에 연결하고, 각 요구사항마다 테스트/브라우저/직접 확인 방법을 요구합니다. 현재 실행에서 읽은 파일만 대상으로 삼습니다. 계획 밖 파일·다른 실행의 계획·해시가 바뀐 계획으로 모델이 변경안을 만들면 거부하고 재계획 안내를 돌려줍니다.
- 계획에는 모델의 가정과 호스트가 계산한 정적 영향 후보를 함께 보관합니다. 관계가 등록되지 않은 파일은 **영향 없음**이 아니라 **추가 확인 필요**입니다. 확인 항목은 `not_run`, 원래 AC는 `unknown`으로 유지합니다.

### 기존 실행기·멀티 에이전트·문맥 관리 재사용

기반은 Theia/Monaco, Pi agent core, OpenWiki 검색입니다. 새 Agent 프레임워크나 자체 편집기를 만들지 않았습니다. Pi core가 도구 호출과 transcript를 관리하고, 확장에서 이미 쓰는 `agent-runtime.js`, `analysis-agents.js`, `context-manager.js`를 Desktop이 직접 가져옵니다. 병렬 분석·문맥 압축은 누비 공통 연결부이며 Pi core 자체의 모든 내장 기능이라고 표현하지 않습니다.

- 문서 검색은 OpenWiki 구조 기반 BM25, 소스 검색·행 읽기는 현재 프로젝트와 소유 worktree에 한정합니다. 검색 결과의 경로·행·해시를 보존합니다. 인터넷 문서 검색이나 새로운 파일 생성까지 자동화한 버전은 아닙니다.
- Desktop의 `completeAnalysis`를 기존 제공자 호출에 연결했습니다. 같은 선택 모델로 최대 두 개의 독립적인 문서·소스 조사 또는 관찰 근거 검토를 수행합니다. 단순 조회는 주 실행기가 처리합니다. 하위 실행은 구체적인 목적·제약·완료 기준과 필요한 근거만 받고 부모 대화 전체는 받지 않습니다.
- 하위 실행은 읽기 도구만 사용하며 코드 제안·계획·질문·셸·재위임 권한이 없습니다. 조회를 했더라도 주 실행기의 수정 구간 관찰을 대신하지 않습니다. 결과는 실제로 읽은 근거 ID를 검증한 제한된 요약으로 돌아오고, 질문/중단 시 하위 모델 요청도 취소됩니다. DB 관계 조회와 변경 계획은 주 실행기가 담당합니다.
- 원본 근거의 제한 조회·검색에는 기존 MiniSearch 기반 evidence 검색을 사용합니다. 완료된 조사는 다음 도구 결정 사이에 전달하고 불필요한 반복 polling을 피합니다. 실제 시작/결과를 한국어 작업 기록으로 표시합니다.
- 모델 카탈로그의 contextLength/maxInputTokens/maxOutputTokens로 문맥 예산을 계산하고 실제 응답의 사용량이 있으면 보정합니다. 요약 후 **원래 목표·모든 완료 조건·이전 질문의 답변**을 다시 포함합니다. 원본은 필요한 행만 재조회하며 오래된 요약은 수정 권한이 아닙니다.
- SQLite 작업/질문/요약 저장과 현재 실행의 하위 분석 저장소는 구분합니다. 앱 재시작 후 실행 중이던 하위 분석이나 도구를 자동 재생하지 않습니다.

[Anthropic 병렬 조사 사례](https://www.anthropic.com/engineering/multi-agent-research-system)의 독립 과제 분리·격리된 문맥·제한된 결과 반환을 적용했습니다. 해당 사례의 성능 수치가 누비에서도 재현됐다는 뜻은 아닙니다. 병렬 호출은 총 토큰 비용을 늘릴 수 있어 독립적인 근거가 필요한 경우에만 선택합니다. [Pi 공식 소스](https://github.com/earendil-works/pi)의 실행 루프를 유지해 기존 누비 제공자·질문·승인 계약을 재검증할 범위를 줄였습니다. 별도 다중 Agent 프레임워크 교체는 상태·인증·취소 경계를 중복 관리하게 하므로 이번에는 선택하지 않았습니다.

### 개념과 근거

업무 개념, 소스, Wiki, 요구사항, 문서, DB, 테이블, 컬럼에 안정된 ID를 부여합니다. 관계에는 방향·종류·출처 해시가 있습니다. 동의어 검색은 항목 찾기에만 사용하고, 문자열이 비슷하다는 이유로 동일 개념/데이터 흐름 관계를 만들지 않습니다.

| 출처 | 화면 표시 | 의미 |
|---|---|---|
| Git의 지식 목록 | 목록에 선언 | 사람이 유지하는 업무/소스 관계. 의미 검증 완료를 뜻하지 않음 |
| `CREATE TABLE` 스냅샷 | DDL에서 추출 | 파서가 관찰한 정의. 실제 DB 상태가 아님 |
| SQLite/원격 드라이버 | DB에서 수집 | 수집 시점의 메타데이터. 코드 실행/업무 정확도의 증거가 아님 |
| 외부 수집기의 JSON | 가져온 메타데이터 | 파일의 주장과 버전. 이 앱이 해당 DB에 접속했다는 증거가 아님 |

Graphology의 방향 그래프로 두 단계 이내의 확인 후보를 계산합니다. 데이터베이스의 모든 테이블을 동일 영향 범위로 퍼뜨리지 않습니다. 같은 파일 해시가 유지돼도 선언한 관계의 의미가 자동 검증되지는 않습니다. 상위 개념의 순환과 끊긴 연결은 표시하고, 추론으로 보충하지 않습니다.

`소스와 Wiki → 업무·코드·DB 관계`에서 동의어 검색, 중심 항목 변경, 관계 방향 확인, 원본 열기, 스키마 대조, Wiki 기록을 사용할 수 있습니다. Wiki 기록은 `openwiki/nubi-map/<UUID>.md`의 새로운 문서이며 이전 문서를 덮어쓰거나 Git에 자동 커밋하지 않습니다. 기록 이후 바뀐 출처를 표시하고, 화면이 관찰한 버전과 내보낼 버전이 다르면 새로고침을 요구합니다. 기존 OpenWiki 검색과 확장의 읽기 전용 Wiki API가 이 문서를 조회할 수 있습니다. OpenWiki Claims 저장소를 직접 수정한 것은 아닙니다.

## DB를 가리지 않는 수집 경계

공통 결과는 `schema / table / columns / references`입니다. 드라이버 추가와 지식 지도·요구사항 분석은 분리했습니다. 현재 연결 경로와 검증 범위는 다음과 같습니다.

| 경로 | 구현 | 실제 검증 |
|---|---|---|
| PostgreSQL | Knex + pg + Schema Inspector | 드라이버 로드·옵션·정규화·실패 격리, 실서버 미검증 |
| MySQL / MariaDB | Knex + mysql2 + Schema Inspector | 드라이버 로드·스키마 범위 계약, 실서버 미검증 |
| SQL Server | Knex + tedious + Schema Inspector | 드라이버 로드·TLS 옵션, 실서버/Windows 인증 미검증 |
| Oracle | Knex + oracledb Thin + Schema Inspector | 드라이버 로드·로그인 스키마 제한, 실서버 미검증. Thin은 12.1 이상; 구형 DB/Wallet/SSO 연결은 별도 |
| SQLite | Node 내장 SQLite의 읽기 전용 연결 | 실제 파일·메타데이터·복합/참조 관계·변경 감지·원본 보존 검사 |
| 기타 DB/사내 수집기 | 버전 1 JSON 메타데이터 입력 | DB2 이름을 가진 합성 파일 정규화, 실제 DB2 접속 아님 |

원격 연결 화면의 주소·사용자·비밀번호는 호스트 메모리에만 있습니다. 앱/실행기 종료와 프로젝트 전환 시 제거됩니다. TLS를 기본 선택하고 인증서 검증을 끄지 않습니다. 사내 CA는 호스트의 정상 신뢰 설정을 사용해야 합니다. 사용자 입력 SQL을 받거나 모델에 DB 실행 도구를 열지 않습니다. 최소 권한의 메타데이터 조회 계정이 운영 전제입니다. SQL Server Windows 통합 인증, Oracle 다른 소유자/Wallet은 지원했다고 표시하지 않습니다.

원격 수집은 별도 Worker에서 최대 30초, 스키마당 테이블 100개·컬럼 300개 이내로 실행합니다. 라이브러리의 메타데이터 조회만 호출하고 기본값·주석·행 데이터를 모델 결과로 전달하지 않습니다. 순차 메타데이터 읽기이므로 동시에 수행된 DDL에 대한 원자적 스냅샷을 주장하지 않습니다. **DB 다시 읽기**가 수집 시점을 갱신합니다. 조회 실패 시 이전 수집 시점의 결과를 보존하며 실패를 표시합니다.

실제 라이브러리 소스에서 PostgreSQL 복합 FK 제외와 Oracle 복합 FK 열 조합 한계를 확인했습니다. 원격 어댑터는 복합 제약을 검증됐다고 만들지 않고 단일 컬럼 관계만 사용하며 수집 범위 경고를 남깁니다. SQLite 직접 수집·명시적 DDL/메타데이터 입력은 순서를 가진 복합 키를 처리합니다. 뷰·트리거·프로시저·인덱스·ORM 동적 쿼리·실행 로그 기반 lineage는 이번 수집 범위가 아닙니다.

## Git 지식 목록

**지식 목록 만들기**는 `.nubi/knowledge.yaml`을 새 파일로만 만듭니다. 기존 파일은 보존합니다. 예:

```yaml
version: 1
entities:
  - id: concept:customer
    kind: concept
    label: 고객
    aliases: [거래처, Customer]
  - id: source:customer
    kind: source
    label: 고객 조회
    path: src/customer.ts
  - id: wiki:customer
    kind: wiki
    label: 고객 정책
    path: openwiki/customer.md
schemas:
  - id: sales
    label: 영업 DB
    mode: connection
    connectionId: project-db
    defaultSchema: public
relations:
  - {from: concept:customer, type: represents, to: table:sales/public/customers}
  - {from: source:customer, type: reads, to: table:sales/public/customers}
  - {from: wiki:customer, type: documents, to: concept:customer}
```

연결 ID만 Git에 기록합니다. 아직 목록에 등록하지 않은 원격 연결도 `connected_<연결 ID>` 네임스페이스로 즉시 볼 수 있습니다. 명시적으로 `schemas`에 등록하면 지정한 ID를 사용합니다.

- DDL: `mode: ddl`, `path: db/schema.sql`, `dialect: Postgresql | MySQL | SQLite`, `defaultSchema` 지정. 64KB 이하의 **현재 CREATE TABLE 스냅샷**을 읽습니다. ALTER/DROP 등을 섞은 마이그레이션을 재생하지 않습니다.
- SQLite: `mode: sqlite`, `path: data/project.db`, `defaultSchema: main`. 프로젝트 내부 파일만 열며 데이터 행을 읽지 않습니다.
- 외부 입력: `mode: metadata`, `path: db/metadata.json`, `defaultSchema` 지정. 수집기의 DB 종류는 제한하지 않지만 공통 계약으로 내보내야 합니다. NoSQL 문서를 자동으로 관계형 테이블처럼 해석하지 않습니다.
- 비교: 비교할 항목에 `compareTo: <기준 schemas ID>`를 추가합니다. 같은 스키마 이름의 테이블·컬럼·자료형 문자열·기본 키만 대조합니다. `INT`/`INTEGER` 같은 DB별 표현도 다르게 보일 수 있고 길이·정밀도·NULL·FK·권한까지 동일하다는 뜻이 아닙니다.
- 테이블 ID: `table:<DB ID>/<스키마>/<테이블>`, 컬럼 ID: `column:<DB ID>/<스키마>/<테이블>/<컬럼>`. SQL 식별자 각 부분은 URL 인코딩합니다.

외부 수집기의 JSON 계약:

```json
{
  "version": 1,
  "engine": "DB2",
  "collectedAt": "2026-09-23T00:00:00Z",
  "tables": [{
    "schema": "APP", "name": "CUSTOMERS",
    "columns": [{"name": "ID", "type": "INTEGER", "primary": true}],
    "references": []
  }]
}
```

FK는 `{"schema":"APP","table":"CUSTOMERS","from":["CUSTOMER_ID"],"to":["ID"]}` 형태입니다. 추가 필드·행 데이터·잘못된 식별자·중복 컬럼은 거부합니다. 외부 시스템에서 이 계약으로 변환하는 부분은 수집기 책임이며 DataHub/OpenMetadata의 임의 응답을 그대로 받는 구현은 아닙니다.

## 방법론·BP·라이브러리 선택

| 참고/채택 | 판단과 실제 반영 |
|---|---|
| [Anthropic 효과적인 Agent](https://www.anthropic.com/engineering/building-effective-agents) | 작은 도구와 관찰 결과를 잇는 흐름, 중간 결정 질문, 코드의 명시적 단계 검사 채택. 새 프레임워크로 기존 Pi를 교체하지 않음 |
| [Anthropic 문맥 관리](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 목표·AC·답변·계획은 유지하고 출처는 필요한 범위로 다시 읽음. 그래프 전체를 매번 프롬프트에 넣지 않고 제한된 관계 조회 도구 제공 |
| [Codex App Server](https://openai.com/index/unlocking-the-codex-harness/) | 작업/질문/도구 결과의 수명과 호스트 상태를 UI에 전달하는 방식을 참고. Codex 런타임이나 구독 OAuth를 새로 내장한 것은 아님 |
| [Anthropic Agent 평가](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | 도구 transcript와 실제 결과를 분리. 잘못된 수정 차단, 질문 재개, 실제 DB 변화, 저장 readback을 독립 검사. 실모델 성공률은 별도 측정 |
| [Backstage 카탈로그](https://backstage.io/docs/features/software-catalog/system-model/) | Git 소유 메타데이터와 컴포넌트/리소스/업무 관계 모델 참고. 별도 Backstage 서버는 도입하지 않음 |
| [W3C SKOS](https://www.w3.org/TR/skos-primer/) | 대표 용어·별칭·상위/관련 개념 패턴 참고. RDF/OWL 표준 구현이나 자동 온톨로지 추론기라고 주장하지 않음 |
| [Knex Schema Inspector](https://github.com/knex/knex-schema-inspector) / [Knex](https://knexjs.org/guide/) | MIT. 여러 DB의 메타데이터 수집에 실제 도입. 복합 FK 한계를 확인해 제한. 원격 DB의 실계정 검증 필요 |
| [node-sql-parser](https://github.com/taozhi8833998/node-sql-parser) | Apache-2.0. 정규식 대신 AST로 DDL 구조 추출. 문법 오류/미지원 구문은 별도 표시 |
| [Graphology](https://graphology.github.io/) | MIT. 방향·다중 관계·제한된 이웃 탐색에 실제 도입. 네트워크 그래프 DB 운영 비용 없이 로컬 사용 |
| [DBHub](https://github.com/bytebase/dbhub) | MIT. 여러 DB를 같은 도구로 묶는 후보로 실제 인터페이스 확인. 서버 전체와 범용 SQL 실행 기능을 더하는 대신 현재는 수집 라이브러리를 직접 사용 |
| [OpenMetadata](https://docs.open-metadata.org/latest/connectors/database) / [DataHub lineage](https://docs.datahub.com/docs/features/feature-guides/lineage/) | 조직 규모의 카탈로그·실행 lineage 연계 후보. 서버·인프라를 Desktop에 묶지 않음. 표준화된 입력 포트만 구현; 직접 API 커넥터는 후속 |
| Ajv, YAML, 기존 Nubi QuestionForm/Pi/OpenWiki | 기존 의존성과 공통 UI 재사용. 엄격한 계약 검증과 질문 재개에 적용. 별도 질문 UI 복제 없음 |

## 다음 평가 기준

실모델 평가에서는 정답이 독립적으로 정의된 변경 요청 묶음을 사용해야 합니다. 사례마다 원본 저장소/DB, 목표, 사용자 답변, 허용 변경 범위, 반드시 보존할 동작, 실행 검사를 고정합니다. 명확한 요청, 모호한 범위, DB/DDL 불일치, 오래된 Wiki, 사람의 동시 수정, 관계 누락, 질문 후 재시작, 실패한 테스트를 포함합니다.

측정할 것은 요구사항 누락률·필수 질문 해결률·불필요한 질문 수·변경 대상 정밀도/누락률·범위 밖 수정·기존 기능 회귀·검증되지 않은 성공 선언·복구 후 작업 보존·시간/토큰 비용입니다. 합성 도구 계약 테스트를 사내 Qwen/실제 DB 정확도로 보고하지 않습니다. 모델 자기평가만으로 AC를 통과시키지 않고, 실행 결과와 독립 평가자의 판정을 연결하는 단계가 남아 있습니다.

## 이번 검증

Desktop 런타임 28개, 실제 Theia UI 21개, 합성 제공자 공통 UI 5개와 재사용 하네스의 문맥/분석 검사 53개가 통과했습니다. 브라우저/Electron 개발 번들도 통과했습니다. 상세 증거와 미검증 경계는 [검증 기록](VERIFICATION.md)에 있습니다. 병렬 모델 응답은 합성 주입이며 실제 사내 모델 성능 측정이 아닙니다.
