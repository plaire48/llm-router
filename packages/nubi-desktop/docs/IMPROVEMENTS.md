# 누비 워크스페이스 개선 — 2026-09-23

## 발견과 실제 반영

| 우선순위 | 확인한 문제 | 반영한 변경 | 확인 방법 |
|---|---|---|---|
| P0 | 모델 도구는 최대 200행을 읽지만 전체 파일 교체를 허용하여 읽지 않은 뒤쪽을 지울 수 있었음 | 실행마다 읽은 해시·행 범위를 추적. 부분 수정은 읽은 범위에서 유일하게 일치하는 문자열만 치환. 전체 교체는 모든 행을 읽어야 허용. CRLF와 나머지 내용 보존, 비 UTF-8 파일 거부 | 실제 Pi에서 잘못된 전체 교체 차단 후 부분 수정으로 복구. 450행 파일의 보지 않은 행, 중복·겹친 위치·오래된 해시 검사 |
| P0 | 다른 실행기가 같은 SQLite를 열면 기존 진행 중 작업을 중단 상태로 바꿀 수 있었음 | 상태 DB와 별도의 SQLite 쓰기 트랜잭션으로 실행 소유권 획득. 획득 실패 시 기존 상태 유지. 프로세스 종료 후 OS 잠금 해제 | 별도 Node 프로세스가 소유한 상태를 다른 실행기가 열지 못함. 강제 종료 후 재열기에서 interrupted로 복구하고 실행을 재전송하지 않음 |
| P1 | 요구사항·소스·실행 결과가 내부 DB에 남고 Git 문서로 이어지지 않았음 | 작업의 ‘소스와 Wiki’에 기록/갱신/열기/다시 확인 추가. 작업공간의 `openwiki/nubi-evidence/<taskId>/`에 Markdown 버전 기록, 동일 근거 no-op, 이전 사람 편집 보존 | 실제 Theia에서 저장·중복 방지·이전 버전 보존·소스 변경 표시. OpenWiki 검색과 Git status로 파일 확인 |
| P1 | 수정 거절 이유가 공통 브라우저 도구 예외 처리에서 일반 오류로 바뀜 | Desktop에서 알려진 입력/관찰 오류만 고정 코드와 재계획 안내로 반환. 임의 예외 내용은 전달하지 않음 | Pi 모델이 source_read_required를 받고 수정 방식 변경. 완료 조건은 그대로 미확인 |
| P1 | Theia 개발 도구의 decompress 및 serialize-javascript에 치명적/높음 취약점 경고 | 유지보수되는 압축 라이브러리와 수정된 직렬화 버전을 고정. CommonJS→ESM 어댑터와 npm override를 저장소에 명시 | Theia가 실제 resolve한 함수로 정상 tar 해제와 외부 hardlink 차단, npm 의존성 트리·audit·빌드 검사 |

## 방법론과 오픈소스 선택

- **관찰 후 작은 수정:** [Anthropic 도구 설계](https://www.anthropic.com/engineering/building-effective-agents)와 [문맥 관리](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)의 작은 도구·명확한 계약·필요한 정보 조회 방식을 적용했습니다. 읽기 범위는 실행마다 초기화하고 요약을 전체 파일 관찰로 간주하지 않습니다. 상대 경로는 고정된 프로젝트/worktree를 기준으로 해석합니다.
- **jsdiff 9.0.0 / BSD-3-Clause:** [실제 API와 릴리스](https://github.com/kpdecker/jsdiff/releases/tag/v9.0.0)를 확인해 `diffLines`를 변경 줄 수 계산에 사용했습니다. 100ms/5,000 edit 제한을 넘으면 줄 수는 미확인으로 둡니다. 모델이 작성한 fuzzy patch 적용이나 복잡한 자체 diff 알고리즘은 도입하지 않았습니다.
- **SQLite 실행 소유권:** [BEGIN IMMEDIATE와 동시 쓰기 계약](https://www.sqlite.org/lang_transaction.html)을 사용했습니다. 별도 owner DB가 하나의 실행기를 보호하고 실제 상태 기록은 기존 WAL DB를 사용합니다. heartbeat 파일 잠금 라이브러리는 지연·stale timeout 판단을 추가하므로 이번 로컬 호스트에는 도입하지 않았습니다. 네트워크 공유 DB/기기 간 잠금으로 확장하지 않습니다.
- **Docs as Code + 시점별 근거:** 기존 OpenWiki·Git·OpenSpec 검토를 재사용했습니다. 기록은 요청·AC·소스 해시·변경 제안·실행 종료 상태·화면 비교의 시점별 문서입니다. 기존 문서는 편집기에 열려 있을 수 있어 갱신도 새 파일로 수행합니다. 원본/현재/AI 문서를 자동 병합해 사람의 의미 변경을 지우는 방식보다 보존을 우선했습니다. 기록별 모델 호출·임베딩·외부 서버 비용은 추가하지 않습니다.
- **압축 라이브러리 교체:** [공식 보안 공지](https://github.com/advisories/GHSA-mp2f-45pm-3cg9)에는 기존 decompress 수정판이 없고 유지보수 포크로 이전하도록 안내되어 있습니다. MIT의 `@xhmikosr/decompress` 11.1.3을 채택했습니다. Theia CLI는 CommonJS 함수, 포크는 ESM이므로 `vendor/decompress-compat`의 얇은 어댑터를 사용합니다. Theia 원본이나 설치된 모듈 소스는 수정하지 않았습니다.
- **직렬화 수정판:** BSD-3-Clause의 [serialize-javascript 7.0.5](https://github.com/yahoo/serialize-javascript/releases/tag/v7.0.5)를 고정했습니다. npm workspace의 간접 의존성만으로 override가 적용되지 않던 문제는 루트 CLI/직렬화 의존성과 어댑터 workspace를 명시하고 `npm ls`로 실제 경로를 검증해 해결했습니다.

CX 공통 컴포넌트와 누비 로그인·모델·대화·애니메이션은 유지했습니다. 새 정보는 ‘소스와 Wiki’ 안에 배치했고 홈의 항목을 늘리지 않았습니다.

## 검증 결과

- 후속 지식/DB/변경 계획까지 런타임/계약 28개, 실제 Theia UI 21개, 합성 제공자 공통 UI 5개 통과. 재사용 분석·문맥 하네스 53개 회귀 검사도 통과.
- 브라우저/Electron 개발 빌드 통과. CX 정적 검사 이슈 0.
- `npm ci --dry-run --ignore-scripts` 통과: 잠금 파일의 설치 계획 검사이며 새로운 Windows 설치 검증은 아닙니다.
- `npm audit`: 치명적 1→0, 높음 1→0. 중간 22·낮음 3의 간접 의존성 항목이 남습니다. 항목 수는 여러 부모 패키지에 전파된 메타 경고를 포함합니다. 전체 취약점 0 또는 배포 준비 완료로 표시하지 않습니다.

남은 직접 원인은 Monaco 내부 DOMPurify 3.2.7, Mocha 내부 diff 7.0.0, react-tooltip/trash 내부 UUID입니다. 특히 [DOMPurify 수정 릴리스](https://github.com/cure53/DOMPurify/releases/tag/3.4.15)는 에디터의 sanitize 계약과 함께 검증하는 다음 의존성 개선 대상으로 기록했습니다. [UUID 공지](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq)의 영향 API는 v3/v5/v6의 외부 버퍼 쓰기이며 이 앱의 실제 호출 경로 전체를 검증했다고 주장하지 않습니다. 이번에는 주요 패키지를 자동 강등하거나 Theia 전체를 무검증 교체하는 `audit fix --force`를 적용하지 않았습니다.

## 후속 반영: 요구사항·DB·공통 하네스

[변경 품질 기록](KNOWLEDGE-QUALITY.md)에 채택 근거와 범위를 정리했습니다. Graphology/SQL Parser/Knex Schema Inspector를 도입하고, 누비의 Pi·OpenWiki·문맥 압축·병렬 조사·QuestionForm을 직접 재사용했습니다. 스키마 정보와 업무 의미의 선언을 구분하며 변경 계획·답변 이력·실제 근거를 연결했습니다. 원격 DB 실서버, 전체 언어의 코드 호출 그래프, 모델 정확도 개선 수치는 아직 검증하지 않았습니다.

## 다음 개선 우선순위와 범위

후속 복구 구현에서 기존 Pi + p-retry 추론 복구, 문맥 초과 압축, SQLite 도구 기록·실제 상태 대조, Bash 실행 전 검사와 실패 원인 분석/명령 수정안/결과 재검토를 연결했습니다. [Anthropic·Codex 방법론과 선택 근거](RECOVERY-HARNESS.md)에 재사용/미도입 판단을 남겼습니다. 전체 LangGraph 실행기는 중복된 상태·승인 계약 비용 때문에 추가하지 않았습니다. 코드/명령 적용은 기존 HITL을 유지하고 미확정 쓰기·사용자 취소는 자동 재실행하지 않습니다. 후속 검증은 런타임 38개·Theia UI 25개·공통 UI 6개·공통 복구 하네스 27개 통과, 브라우저/Electron 빌드 및 CX 검사 통과입니다. 실모델 진단 정확도·Windows 셸 검증은 남아 있습니다.

1. **에디터 간접 의존성 정리:** DOMPurify 등 수정 버전의 Monaco/툴팁/파일 작업 호환성 검증. Windows 배포 전 다시 검사합니다.
2. **현재 근거의 정밀도:** 기록의 최신 여부는 사용자가 다시 확인하거나 해당 작업 화면에 들어올 때 검사합니다. 파일 감시·과거 Wiki 버전의 검색 우선순위·서버 빌드와 소스 버전의 연결을 개선해야 합니다. 지금도 과거 기록에 시점과 미검증 상태를 명시합니다.
3. **요구사항별 실제 검증:** 종료 코드·픽셀 차이와 AC 판정은 분리되어 있습니다. 프로젝트별 테스트 명령·메뉴·검증 시나리오를 묶는 adapter와 실제 사내 모델 평가가 필요합니다.
4. **OpenWiki 내용 생성과 배포 환경:** 이번 기록 기능은 전체 프로젝트 Wiki의 자동 설명 생성/주기적 갱신이 아닙니다. OpenWiki 생성기의 Claims·단계 재개·사용자 편집 보존 경로를 연결하고, Windows 실행/설치·실계정·웹 확장·Office 수신/저장은 각각 검증해야 합니다.

자동 commit/push·배포·Office 최종 빌드는 수행하지 않았습니다.

## 화면 문구 정리

사용자 기준에 맞춰 핵심 결과와 다음 행동을 먼저 썼습니다. 중간점 나열은 간격이나 줄바꿈으로 바꾸고, 오류의 원인과 복구 행동은 유지했습니다. 관계 화면의 내부 식별자는 감추되 원본 출처와 수집 시점은 남겼습니다. AI 답변과 질문에도 같은 작성 기준을 적용했습니다.

설치된 CX의 짧은 문구와 정보 위계 기준을 재사용했습니다. 기존 컴포넌트만으로 처리할 수 있어 새 라이브러리는 추가하지 않았습니다. 모델 답변의 실제 간결성은 실모델 평가 전입니다.

## OpenWiki 근거 연결

관련 문서를 찾은 뒤 현재 코드에 다시 연결하는 흐름을 보완했습니다. 기존 MiniSearch와 Graphology 검색을 RRF로 합치고 OpenWiki Claims와 repository resolver를 재사용합니다. 요구사항에 연결한 문서가 바뀌면 계획과 변경 제안을 다시 검토합니다. 중복된 과거 작업 기록은 기본 검색에서 제외하고 출처 상태를 기존 검색 화면에 표시합니다. 선택 근거, 미도입 항목과 평가 한계는 [OPENWIKI-EVIDENCE.md](OPENWIKI-EVIDENCE.md)에 기록했습니다.
