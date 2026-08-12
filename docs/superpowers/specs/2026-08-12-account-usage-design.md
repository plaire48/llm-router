# 계정 사용량 패널 설계 문서 (Claude Enterprise + ChatGPT Enterprise)

- 날짜: 2026-08-12
- 상태: Claude Enterprise 구현 완료, 실제 조직 키 스모크 테스트·플랜 확인 및 ChatGPT 스파이크 대기
- 선행: `2026-08-12-usage-dashboard-design.md` (라우터 자체 사용량 대시보드)
- **정정 이력:** 초판은 Console Admin API(`usage_report/messages`)와 OpenAI 플랫폼 조직 API를 전제했다. 사용자 조직이 **Claude Enterprise + ChatGPT Enterprise**로 확인되어 전면 교체했다. 두 Enterprise 제품은 API·키 종류가 모두 다르다.

## 1. 목표

대시보드에서 **세 가지 사용량을 나란히** 본다.

| 소스 | 무엇을 보여주나 | 왜 필요한가 |
|---|---|---|
| **라우터 계측** (구현 완료) | 이 라우터를 거쳐 간 호출의 실제 토큰 수 | 내가 진짜 얼마나 썼는지 — 즉시, 요청 단위, 제공자 무관하게 가로질러 |
| **Claude Enterprise 계정** (신규) | 조직 전체 사용자별·조직별 토큰/비용 | 라우터 밖 사용량 포함, 청구와 대조 |
| **ChatGPT Enterprise 계정** (신규, 불확실) | 워크스페이스 사용량 | 위와 동일 — 단 §2.2 참고 |

라우터 계측은 **대체되지 않는다.** 계정 API는 조직 전체를 수 시간 지연으로 집계하고 최대 30일간 값이 수정된다. 라우터는 내 호출만 즉시·요청 단위로 보여준다. 서로 다른 질문에 답한다.

## 2. 조사 결과 (2026-08-12 공식 문서 확인)

### 2.1 Claude Enterprise — Analytics API ✅ 확정

| 항목 | 값 |
|---|---|
| API | **Claude Enterprise Analytics API** (Console Admin API가 **아님**) |
| 베이스 | `https://api.anthropic.com/v1/organizations/analytics/` |
| 키 종류 | **Analytics API key** (`read:analytics` 스코프) |
| 키 발급 | claude.ai > Organization settings > API — **primary owner만** 가능, 먼저 public API access를 켜야 함 |
| 인증 헤더 | `x-api-key` |
| 제공 데이터 | 사용자별 활동, 활동 요약, 프로젝트/스킬/커넥터 사용, **비용·사용량 리포트(사용자별 + 조직 전체 토큰·비용)** |
| 데이터 시작일 | **2026-01-01 이후만** |
| 비용·사용량 신선도 | 보통 4시간, 최대 24시간 |
| 값 수정 | 최대 **30일간** 재조정됨. 청구 등급 수치는 30일 이상 지난 날짜를 조회 |
| 레이트 리밋 | **조직 단위 60 req/min** (키 단위 아님) |
| 리스트 파라미터 | 대괄호 표기 — `products[]=chat&products[]=claude_code` |

**반드시 알아야 할 세 가지 함정:**

1. **요금제에 따라 의미가 다르다.** 공식 문서: *"cost and usage 엔드포인트는 **usage-based** Enterprise 플랜에 적용되고, **seat-based** Enterprise 플랜에서는 **usage credits만** 반영한다."* 시트 기반 플랜이면 토큰 비용이 아니라 크레딧 소진량을 보게 된다. **금액/크레딧을 UI에 표시하기 전에 어느 플랜인지 확인해야 한다.**
2. **금액은 센트 단위 십진 문자열.** `"41280.000000"` = **$412.80**. 달러로 바꾸려면 십진 파싱 후 100으로 나눈다. 수백만 달러를 넘길 수 있으므로 **이진 부동소수점 파싱 금지**.
3. **`data_refreshed_at` 이후 구간은 불완전하다.** `ending_at`을 생략하면 응답 꼬리에 미완성 데이터가 붙는다. 반복 호출에서 값이 흔들리지 않게 하려면 `ending_at`을 **이전 응답의 `data_refreshed_at` 이하로** 설정한다.

기타: 페이지네이션 커서는 발급 시점의 쿼리에 묶인다 — 파라미터를 바꾸면 400이므로 커서 없이 처음부터 다시 시작해야 한다. Amazon Bedrock 경유 Claude Code 사용량은 이 API에 나오지 않는다.

### 2.2 ChatGPT Enterprise — 불확실 ⚠️

공개 문서만으로는 **일반 워크스페이스 사용량을 뽑는 프로그래밍 API를 확인하지 못했다.** 확인된 것과 못 한 것을 구분해 적는다.

**확인된 것:**

- 워크스페이스 분석 대시보드(Workspace Settings → Analytics): 채택·참여 지표, **CSV 내보내기** 제공.
- **Analytics API가 존재한다** — 다만 도달 가능한 공식 문서는 **Codex 범위**로 서술돼 있고, 같은 문서가 *"ChatGPT 워크스페이스 분석과 Codex 분석은 서로 다른 제품 범위를 다룬다"* 고 명시한다.
- Analytics API 인증: **"Platform organization API key"**, 그리고 *"키의 조직이 워크스페이스의 조직과 일치해야 한다"*.
- Compliance API: `api.chatgpt.com/v1/compliance` — 감사·법무용 대화 기록(JSONL). **사용량 분석용이 아니다.**

**확인 못 한 것:** 라우트·스키마·파라미터·페이지네이션 계약 전체가 **인증 포털 뒤에** 있다 — `https://chatgpt.com/codex/cloud/settings/apireference`. 공식 문서가 *"인증된 레퍼런스가 현재의 키 발급, 스코프 요건, 라우트, 스키마, 필드, 시간 의미론, 페이지네이션 동작을 소유한다. 이 페이지는 그 계약을 복제하지 않는다"* 고 명시한다.

> 서드파티 블로그들은 "OpenAI가 Admin API에 사용량 분석 엔드포인트를 추가했다"고 주장하지만 **OpenAI 자체 문서로 확인되지 않았다.** 근거 없는 구현을 시작하지 않는다.

**따라서 ChatGPT Enterprise 소스는 스파이크가 선행한다** — §5 참고.

### 2.3 이 프로젝트에 중요한 사실

**계정 사용량 API는 우리가 가진 구독 OAuth 토큰으로 접근할 수 없다.** 완전히 분리된 축이다.

| 목적 | 자격증명 | 발급 주체·위치 |
|---|---|---|
| 추론 (구현 완료) | 구독 OAuth 토큰 | 사용자 브라우저 로그인 |
| Claude Enterprise 사용량 | Analytics API key | **primary owner**, claude.ai 조직 설정 |
| ChatGPT Enterprise 사용량 | Platform organization API key | 워크스페이스와 같은 조직 |

**그리고 "구독 잔여량"은 여전히 이 API들로 안 나온다.** Claude Enterprise가 seat-based 플랜이면 **usage credits** 소진량은 볼 수 있다 — 이게 잔여량에 가장 근접한 값이지만, Pro/Max 개인 구독의 잔여 할당량과는 다른 개념이다.

## 3. 설계

### 3.1 구조

기존 `usage/` 모듈에 **어카운트 소스**를 추가한다. 라우터 계측 경로는 그대로 둔다.

```
/dashboard
 ├─ [라우터 계측]        ← SQLite (기존, 즉시·요청 단위)
 ├─ [Claude Enterprise]  ← GET /v1/account/claude/usage   → Analytics API 프록시
 └─ [ChatGPT Enterprise] ← GET /v1/account/chatgpt/usage  → 스파이크 후 결정
```

브라우저가 제공자 API를 직접 부르지 않는다. **라우터가 프록시**한다 — 관리자 키가 브라우저로 나가면 안 되고, CORS도 피한다.

### 3.2 구성 요소

- `usage/accounts/base.py` — `AccountUsageSource` 프로토콜: `async def usage(days: int) -> AccountUsage`
- `usage/accounts/claude_enterprise.py` — Analytics API 호출 + 정규화
- `usage/accounts/chatgpt_enterprise.py` — **스파이크 완료 후 작성**
- `usage/accounts/__init__.py` — `.env` 키 존재 여부로 사용 가능한 소스 구성

**정규화된 공통 모양:**

```python
@dataclass
class AccountUsageBucket:
    day: str                   # YYYY-MM-DD
    label: str | None          # 모델 또는 사용자 — 제공자별 그룹 축
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    amount_usd: Decimal | None  # 센트 문자열 / 100. float 금지
    basis: Literal["cost", "credits", "unknown"]  # seat-based면 "credits"
```

`basis` 필드가 있는 이유: seat-based 플랜은 비용이 아니라 크레딧이므로, UI가 이걸 "비용"으로 잘못 부르지 않게 한다.

### 3.3 설정 (`.env`)

```
CLAUDE_ANALYTICS_KEY=...    # 없으면 Claude 패널 비활성
CHATGPT_ANALYTICS_KEY=...   # 스파이크 완료 후 활성
```

키가 없으면 패널을 숨기지 않고 **"설정되지 않음 + 발급 방법 안내"**(primary owner가 claude.ai 조직 설정에서 발급)를 보여준다.

### 3.4 캐싱 (필수)

조직 단위 60 req/min 제한이 있고 데이터는 수 시간 지연된다. 대시보드를 열 때마다 부르면 안 된다.

- 응답을 **5분 메모리 캐시** (데이터 신선도가 4~24시간이므로 60초는 무의미하게 공격적).
- `ending_at`은 **직전 응답의 `data_refreshed_at` 이하로** 고정해 값이 흔들리지 않게 한다.

### 3.5 에러 처리

계정 패널의 실패가 **라우터 계측 패널을 깨뜨리면 안 된다.** 각 패널은 독립 로드, 실패는 그 패널 안에서만 표시.

| 상황 | 표시 |
|---|---|
| 키 미설정 | "설정되지 않음" + primary owner 발급 안내 |
| 401/403 | "키가 유효하지 않거나 스코프 부족 (`read:analytics` 필요)" |
| 400 + 날짜 | "요청한 날짜의 데이터가 아직 없음" — 에러가 알려주는 최신 가용일 표시 |
| 2026-01-01 이전 조회 | "이 API는 2026-01-01부터 데이터를 제공합니다" |
| 429 | "조직 단위 한도(60/min) — 캐시된 마지막 값 표시" |

### 3.6 UI

섹션 3개, 동일한 시각 언어(일자별 막대 + 요약 타일). 각 헤더에 **출처와 신선도**를 명시한다:

- 라우터 계측: "이 라우터를 거친 호출 · 실시간"
- Claude Enterprise: "조직 전체 · 최대 24시간 지연 · 30일간 값 조정됨"

같은 기간의 두 숫자가 다를 수 있으므로(라우터 밖 사용량, 집계 지연, 사후 조정) 출처를 적어두면 혼란이 없다. seat-based 플랜이면 금액 타일 라벨을 **"크레딧"**으로 바꾼다.

## 4. 범위에서 제외

- **구독 잔여량** — 공식 API 없음. seat-based의 크레딧 소진량이 가장 근접.
- **Compliance API** (대화 내용·감사 기록) — 목적이 다르고 민감도가 훨씬 높다.
- **Claude Code 사용자별 생산성 지표** — Analytics API에 있지만 이번 범위는 토큰·비용에 한정.
- 비용 알림·예산 임계값.

## 5. 선행 스파이크

### 5A. Claude Enterprise 플랜 확인 (필수, 5분)

**usage-based인가 seat-based인가?** 이것이 비용 숫자의 의미를 결정한다. Analytics API 키를 발급받아 cost/usage 엔드포인트를 1회 호출하고 응답이 실제 비용인지 크레딧인지 확인해 `basis` 기본값을 정한다.

### 5B. ChatGPT Enterprise Analytics API 발견 (필수)

인증 포털(`https://chatgpt.com/codex/cloud/settings/apireference`)에 접속해 확인할 것:

1. ChatGPT **워크스페이스** 사용량 엔드포인트가 존재하는가, 아니면 **Codex 전용**인가?
2. 존재한다면 라우트·파라미터·응답 스키마·페이지네이션.
3. 토큰 수를 주는가, 메시지/시트 수만 주는가?
4. Platform organization API key 발급 절차와 필요 역할.

**결과에 따라 분기:** 워크스페이스 사용량 API가 있으면 Claude와 동형으로 구현. Codex 전용이면 해당 범위만 구현하고 UI에 명시. 아무것도 없으면 **CSV 내보내기 업로드**로 대체(대시보드에서 내려받은 CSV를 라우터가 파싱해 표시).

## 6. 출처

- [Analytics APIs — 어느 API·키가 필요한가](https://platform.claude.com/docs/en/manage-claude/analytics-api)
- [Usage and Cost API (Console 조직용 — 우리 경우엔 해당 없음)](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
- [Admin API](https://platform.claude.com/docs/en/api/administration-api.md)
- [ChatGPT Enterprise Workspace analytics](https://learn.chatgpt.com/docs/enterprise/workspace-analytics)
- [ChatGPT Enterprise Analytics API](https://learn.chatgpt.com/docs/enterprise/analytics-api)
- [ChatGPT Enterprise Compliance API](https://learn.chatgpt.com/docs/enterprise/compliance-api)
