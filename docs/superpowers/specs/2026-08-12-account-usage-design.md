# 계정 사용량 패널 설계 문서 (Anthropic + OpenAI)

- 날짜: 2026-08-12
- 상태: 조사 완료, 설계 제안 (사용자 승인 대기)
- 선행: `2026-08-12-usage-dashboard-design.md` (라우터 자체 사용량 대시보드)

## 1. 목표

대시보드에서 **세 가지 사용량을 나란히** 본다.

| 소스 | 무엇을 보여주나 | 왜 필요한가 |
|---|---|---|
| **라우터 계측** (구현 완료) | 이 라우터를 거쳐 간 호출의 실제 토큰 수 | 내가 진짜 얼마나 썼는지 — 즉시, 요청 단위, 제공자 무관하게 가로질러 |
| **Anthropic 계정** (신규) | 조직 전체 토큰 사용량·비용 | 라우터 밖 사용량 포함, 청구서와 대조 |
| **OpenAI 계정** (신규) | 조직 전체 사용량·비용 | 위와 동일 |

라우터 계측은 **대체되지 않는다.** 계정 API는 조직 전체를 늦게(~5분) 집계해 주는 반면, 라우터는 내 호출만 즉시·요청 단위로 보여준다. 둘은 서로 다른 질문에 답하므로 함께 둔다.

## 2. 조사 결과 (2026-08-12 공식 문서 확인)

### 2.1 Anthropic — Usage & Cost Admin API

| 항목 | 값 |
|---|---|
| 사용량 | `GET https://api.anthropic.com/v1/organizations/usage_report/messages` |
| 비용 | `GET https://api.anthropic.com/v1/organizations/cost_report` |
| 인증 | `x-api-key: sk-ant-admin01-...` + `anthropic-version: 2023-06-01` |
| 시간 범위 | `starting_at`, `ending_at` (ISO 8601) |
| 버킷 | `bucket_width=1m|1h|1d` |
| 그룹핑 | `group_by[]=model|workspace_id|api_key_id|service_tier|context_window|inference_geo|speed` |
| 필터 | `models[]`, `workspace_ids[]`, `api_key_ids[]`, `service_tiers[]`, … |
| 토큰 구분 | uncached input / cached input / cache creation / output |
| 비용 버킷 | **1d 전용**, USD |
| 페이징 | `has_more` + `next_page` |
| 데이터 지연 | 보통 5분 이내 |
| 폴링 권장 | 지속 사용 시 분당 1회 이하 |

**버킷 상한** (초과 시 페이징 필요):

| 단위 | 기본 | 최대 |
|---|---|---|
| `1m` | 60 | 1,440 |
| `1h` | 24 | 168 |
| `1d` | 7 | 31 |

**중요한 제약:**

- **개인 계정은 사용 불가.** 조직(Organization)이 있어야 하고, Admin API key는 admin 역할만 발급할 수 있다.
- **Claude Enterprise(claude.ai)는 이 API가 아니다.** 별도의 **Claude Enterprise Analytics API**와 **Analytics API key**를 쓴다. Claude Enterprise 조직은 Console에 나타나지 않고 Admin API key가 없다.
- Priority Tier 비용은 cost_report에 포함되지 않는다(usage로 추적).
- Code Execution 비용은 cost_report의 `description`에만 나오고 usage에는 없다.
- Claude Code **사용자별** 비용은 별도의 Claude Code Analytics API.

### 2.2 OpenAI — Admin usage/cost API

| 항목 | 값 |
|---|---|
| 사용량 | `GET https://api.openai.com/v1/organization/usage/completions` |
| 비용 | `GET https://api.openai.com/v1/organization/costs` |
| 인증 | `Authorization: Bearer $OPENAI_ADMIN_KEY` (admin key) |
| 시간 범위 | `start_time`, `end_time` — **Unix 초** (Anthropic의 ISO 8601과 다름) |
| 그룹핑 | `project_id`, `user_id`, `api_key_id`, `model`, `batch`, `service_tier` |

**중요:** 재무 목적이면 usage가 아니라 **costs**를 봐야 한다. usage는 세밀하지만 청구서와 정확히 일치하지 않을 수 있다(공식 문서 명시).

### 2.3 이 프로젝트에 중요한 사실

**계정 사용량 API는 우리가 이미 가진 구독 OAuth 토큰으로 접근할 수 없다.** 별도의 관리자 키가 필요하다:

| 무엇을 보려는가 | 필요한 자격증명 | 어디서 얻나 |
|---|---|---|
| Anthropic API 조직 사용량 | Admin API key (`sk-ant-admin01-...`) | Console, admin 역할 |
| Claude Enterprise(claude.ai) 사용량 | Analytics API key | claude.ai |
| OpenAI 조직 사용량 | OpenAI Admin key | OpenAI 플랫폼, owner 역할 |

즉 **구독 OAuth(추론용)와 관리자 키(집계 조회용)는 완전히 분리된 축**이다. 구독으로 로그인했다고 사용량 API가 열리지 않고, 반대도 마찬가지다.

**그리고 "구독 잔여량"은 여전히 이 API들로 안 나온다.** 이 API들은 **API 조직의 과금형 사용량**을 보여준다. Claude Pro/Max나 ChatGPT Plus 구독의 잔여 할당량을 알려주는 공식 엔드포인트는 여전히 없다.

## 3. 설계

### 3.1 구조

기존 `usage/` 모듈에 **어카운트 소스**를 추가한다. 라우터 계측 경로는 그대로 둔다.

```
/dashboard
 ├─ [라우터 계측]  ← SQLite (기존, 즉시·요청 단위)
 ├─ [Anthropic 계정] ← GET /v1/account/anthropic/usage  → Admin API 프록시
 └─ [OpenAI 계정]    ← GET /v1/account/openai/usage     → Admin API 프록시
```

브라우저가 제공자 API를 직접 부르지 않는다. **라우터가 프록시**한다 — 관리자 키가 브라우저로 나가면 안 되고, CORS도 피할 수 있다.

### 3.2 구성 요소

- `usage/accounts/base.py` — `AccountUsageSource` 프로토콜: `async def usage(days: int) -> AccountUsage`
- `usage/accounts/anthropic.py` — Admin API 호출 + 정규화
- `usage/accounts/openai.py` — Admin API 호출 + 정규화 (Unix 초 변환 포함)
- `usage/accounts/__init__.py` — `.env` 키 존재 여부로 사용 가능한 소스 구성

**정규화된 공통 모양** (두 제공자의 응답 차이를 여기서 흡수):

```python
@dataclass
class AccountUsageBucket:
    day: str              # YYYY-MM-DD
    model: str | None
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cost_usd: float | None   # 비용 API가 없거나 실패하면 None
```

### 3.3 설정 (`.env`)

```
ANTHROPIC_ADMIN_KEY=sk-ant-admin01-...   # 없으면 Anthropic 패널 비활성
OPENAI_ADMIN_KEY=sk-admin-...            # 없으면 OpenAI 패널 비활성
```

**키가 없으면 패널을 숨기지 않고 "설정되지 않음 + 발급 방법 안내"를 보여준다.** 조용히 사라지면 왜 안 보이는지 알 수 없다.

### 3.4 캐싱 (필수)

제공자 API는 폴링 제한이 있고(Anthropic: 분당 1회 권장) 데이터는 ~5분 지연된다. 대시보드를 열 때마다 부르면 안 된다.

- 응답을 **60초 메모리 캐시**한다.
- 대시보드 새로고침은 캐시를 읽는다.
- 캐시 만료 시에만 업스트림 호출.

### 3.5 에러 처리

계정 패널의 실패가 **라우터 계측 패널을 깨뜨리면 안 된다.** 각 패널은 독립적으로 로드하고, 실패는 그 패널 안에서만 표시한다.

| 상황 | 표시 |
|---|---|
| 키 미설정 | "설정되지 않음" + 발급 안내 |
| 401/403 | "키가 유효하지 않거나 권한 부족 (admin 역할 필요)" |
| 개인 계정 | "조직이 없는 개인 계정은 이 API를 쓸 수 없습니다" |
| 429 | "요청 한도 — 잠시 후 재시도" + 캐시된 마지막 값 표시 |
| 그 외 | 상태코드와 제공자 메시지 |

### 3.6 UI

기존 대시보드에 탭 또는 섹션 3개. 각 섹션은 동일한 시각 언어(일자별 막대 + 요약 타일)를 쓰되, 헤더에 **데이터 출처와 신선도**를 명시한다:

- 라우터 계측: "이 라우터를 거친 호출 · 실시간"
- 계정: "조직 전체 · 약 5분 지연 · 60초 캐시"

같은 기간의 두 숫자가 다를 수 있는데(라우터 밖 사용량, 집계 지연), 출처를 적어두면 혼란이 없다.

## 4. 범위에서 제외

- **구독 잔여량** — 공식 API 없음 (§2.3). 별도 스파이크 주제로 남긴다.
- **Claude Enterprise Analytics API** — Admin API와 키 종류·엔드포인트가 다르다. 사용자가 Enterprise 조직을 쓴다고 확인되면 별도 소스로 추가.
- **Claude Code Analytics API** (사용자별 비용) — 별도 엔드포인트.
- 비용 알림·예산 임계값.

## 5. 테스트 전략

- **단위**: 각 제공자 응답 픽스처 → 정규화 결과 검증(특히 OpenAI Unix 초 ↔ ISO 변환, Anthropic 4종 토큰 합산).
- **통합**: respx로 업스트림 목킹, 캐시가 60초 내 재호출을 막는지, 한 소스 실패가 다른 소스에 영향 없는지.
- **API**: 키 미설정 시 503 대신 "미설정" 상태를 정상 응답으로 반환하는지, 마스터 키 인증이 걸리는지.

## 6. 출처

- [Admin API](https://platform.claude.com/docs/en/api/administration-api.md)
- [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
- [OpenAI Usage API reference](https://platform.openai.com/docs/api-reference/usage/completions)
- [OpenAI Costs API reference](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)
