import asyncio
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from llm_router.config import ProfileRegistry, Settings
from llm_router.errors import RouterError
from llm_router.models import Profile
from llm_router.server import create_app
from llm_router.usage import UsageStore
from llm_router.usage.routes import build_usage_router
from llm_router.usage.store import CallRecord

SETTINGS = Settings(master_key="sk-local", host="127.0.0.1", port=8787, _env_file=None)
REGISTRY = ProfileRegistry(
    [
        Profile(
            name="c",
            provider="anthropic",
            auth="api_key",
            api_key_env="ANTHROPIC_API_KEY",
            model="claude-sonnet-4-5",
        )
    ]
)
AUTH = {"authorization": "Bearer sk-local"}


def _seed(store: UsageStore) -> None:
    asyncio.run(
        store.record(
            CallRecord(
                started_at=time.time(),
                profile="c",
                provider="anthropic",
                upstream_model="claude-sonnet-4-5",
                stream=False,
                duration_ms=42,
                status=200,
                ok=True,
                prompt_tokens=8,
                completion_tokens=2,
                total_tokens=10,
                request_body='{"q":1}',
                response_body='{"a":2}',
            )
        )
    )


def test_usage_endpoints_require_auth(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
            assert client.get("/v1/usage/summary").status_code == 401
            assert client.get("/v1/usage/calls").status_code == 401
    finally:
        store.close()


def test_summary_and_calls_and_detail(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        _seed(store)
        with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
            summary = client.get("/v1/usage/summary?days=7", headers=AUTH).json()
            assert summary["data"][0]["profile"] == "c"
            assert summary["data"][0]["total_tokens"] == 10
            assert summary["data"][0]["provider"] == "anthropic"
            assert summary["data"][0]["upstream_model"] == "claude-sonnet-4-5"
            assert "estimated_usd" not in summary["data"][0]

            listed = client.get("/v1/usage/calls", headers=AUTH).json()
            assert listed["data"][0]["duration_ms"] == 42
            assert "request_body" not in listed["data"][0]

            call_id = listed["data"][0]["id"]
            detail = client.get(f"/v1/usage/calls/{call_id}", headers=AUTH).json()
            assert detail["request_body"] == '{"q":1}'

            missing = client.get("/v1/usage/calls/99999", headers=AUTH)
            assert missing.status_code == 404
    finally:
        store.close()


def test_usage_endpoints_report_disabled_without_store():
    with TestClient(create_app(SETTINGS, REGISTRY)) as client:
        response = client.get("/v1/usage/summary", headers=AUTH)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "usage_disabled"


def test_dashboard_serves_self_contained_html(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
            response = client.get("/dashboard")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        body = response.text
        assert "LLM Router" in body
        assert "<h2>연결</h2>" in body
        assert "브라우저 계정" in body
        assert "API 연결" in body
        assert 'id="browser-connections"' in body
        assert 'id="api-connections"' in body
        assert "LLM 서빙" in body
        assert 'class="appbar"' in body
        assert 'class="sidebar"' not in body
        assert "/* iOS desktop visual system */" in body
        assert "--bg: #f2f2f7" in body
        assert "grid-template-columns: 170px minmax(0,1fr) 170px" in body
        assert "min-height: 56px; gap: 8px" in body
        assert ".nav button.active::after { opacity: 1; transform: scaleX(1); }" in body
        assert 'aria-current="page"' in body
        assert 'button.setAttribute("aria-current","page")' in body
        assert "backdrop-filter: saturate(180%) blur(24px)" in body
        assert "관리 서버 실행 중" not in body
        assert "연결 추가" in body
        assert 'id="refresh" type="button" title="새로고침" aria-label="새로고침"><svg' in body
        assert 'id="top-add"' not in body
        assert "M14.2 7.9v6" in body
        assert 'data-disconnect="${item.provider}"' in body
        assert 'class="connection-state ${kind}"' in body
        assert 'data-provider="${esc(item.provider)}"' in body
        assert 'class="brand-glyph claude-glyph"' in body
        assert 'class="brand-glyph openai-glyph"' in body
        assert 'viewBox="0 0 125 125"' in body
        assert 'viewBox="146 227 268 265"' in body
        assert ".provider-logo .brand-glyph" in body
        assert 'providerGlyph("anthropic")' in body
        assert 'providerGlyph("openai")' in body
        assert "사내 LLM" in body
        assert "OpenAI 호환 LLM" in body
        assert 'id="profile-auth-mode"' in body
        assert '<option value="none">인증 없음</option>' in body
        assert "API Key를 요구하지 않는 내부 Endpoint" in body
        assert 'profile.auth==="none"?"인증 없음"' in body
        assert 'const auth=await api("/v1/auth/status")' in body
        assert 'statusLabel=policyDisabled?"정책상 중단"' in body
        assert 'expired?"토큰 만료"' in body
        assert 'data-new-type="${type}"' in body
        assert 'apiConnectionCard("fabrix","FabriX","사내 API","fabrix")' in body
        assert 'apiConnectionCard("openai_compatible","OpenAI 호환 LLM"' in body
        assert 'apiConnectionCard("aipro","AI Pro"' in body
        assert 'const AI_PRO_ENDPOINT = "https://aipro.sdsdev.co.kr/open/api/v1"' in body
        assert 'const AI_PRO_BROWSER_ENDPOINT = "https://aipro.sdsdev.co.kr/api/v1"' in body
        assert "state.auth.map(browserConnectionCard)" in body
        assert "async function pollLogin(provider)" in body
        assert "로그인이 완료되어 프로필에 자동 반영했습니다." in body
        assert "await pollLogin(provider)" in body
        assert 'profile.auth==="oauth"?"SAML JWT · OpenCode":"API 키 · OpenCode"' in body
        assert 'aipro_browser:{model:"",baseUrl:AI_PRO_BROWSER_ENDPOINT}' in body
        assert 'aipro:{model:"",baseUrl:AI_PRO_ENDPOINT}' in body
        assert 'aipro_browser:["aipro","oauth"]' in body
        assert 'aipro:["aipro","api_key"]' in body
        assert 'const isAIProBrowser=type==="aipro_browser"' in body
        assert '$("#top-add")' not in body
        assert 'id="page-add"' not in body
        assert 'showPage("connections")' in body
        assert 'id="page-serving" hidden' in body
        assert "연결 메뉴에서 계정이나 사내 LLM을 먼저 연결하세요." in body
        assert "OpenAI Codex" not in body
        assert "Enterprise 계정 크레딧" in body
        assert "ChatGPT 계정 OAuth" in body
        assert "내부 OpenCode가 전용 ChatGPT OAuth 세션을 생성합니다." in body
        assert "OpenAI와 Claude는 브라우저 로그인만 사용합니다." not in body
        assert "API 인증은 FabriX 또는 OpenAI 호환 사내 LLM 프로필에만 입력합니다." not in body
        assert "Anthropic · API 키" not in body
        assert "OpenAI · API 키" not in body
        assert 'value="anthropic_key"' not in body
        assert 'value="openai_key"' not in body
        assert '<select id="connection-type"' not in body
        assert 'id="connection-picker"' not in body
        assert 'name="connection-type"' not in body
        assert 'connectionType:"fabrix"' in body
        assert "state.connectionType=type" in body
        assert 'id="opencode-integration"' not in body
        assert "/v1/connect/opencode" not in body
        assert "격리된 ChatGPT 계정 OAuth · OpenCode 내부 실행" in body
        assert 'rel="icon" href="/favicon.svg?v=arrow-v1"' in body
        assert "프로필·모델별 사용량" in body
        assert "<h2>대시보드</h2>" in body
        assert "사용량 대시보드" not in body
        assert 'class="account-budget-grid"' in body
        assert "사용 금액" in body
        assert "사용 크레딧" in body
        assert "Enterprise 계정 크레딧" in body
        assert "크레딧 사용률" in body
        assert "전체 한도" in body
        assert "사용률" in body
        assert "1년 토큰 활동" in body
        assert "최근 1년" in body
        assert 'id="usage-heatmap"' in body
        assert "function compactTokens(value)" in body
        assert 'title="${esc(tokenLabel)}"' in body
        assert "const ariaLabel=`${dayLabel} · ${tokenLabel}`" in body
        assert 'value="365"' in body
        assert "segment-meter" in body
        assert 'style="width:${pct}%"' in body
        assert "grid-auto-columns: minmax(13px,1fr); gap: 4px" in body
        assert ".heatmap { min-width: 900px; }" in body
        assert 'id="gateway"' in body
        assert "단일 로컬 Gateway" in body
        assert "model 값으로 프로필을 선택합니다." in body
        assert "Request model" in body
        assert 'id="profile-port"' not in body
        assert 'id="start-after-save"' not in body
        assert "data-start=" not in body
        assert "data-stop=" not in body
        assert "로컬 호출 예상 비용" not in body
        assert "예상 $" not in body
        assert 'id="sum-cost"' not in body
        assert "pricing-note" not in body
        assert "moneyFromMinor" in body
        assert "creditMarkup" in body
        assert "creditBalanceMarkup" in body
        assert 'class="credit-unit">크레딧</span>' in body
        assert "OpenAI 계정 API에서 직접 조회" in body
        assert "로컬 추정값 아님" in body
        assert 'fetch("/v1/dashboard/session"' in body
        assert "response.status===401&&retrySession" in body
        assert 'credentials:"same-origin"' in body
        assert "/v1/usage/summary?days=365" in body
        assert 'id="usage-profile"' in body
        assert 'id="usage-model"' in body
        assert "/v1/usage/account/claude" in body
        assert "/v1/usage/account/openai" in body
        assert "CLAUDE_ENTERPRISE_ADMIN_KEY" not in body
        assert "/v1/usage/organization" not in body
        assert "한도 저장" not in body
        assert "key-form" not in body
        assert "master-key" not in body
        assert "sessionStorage" not in body
        assert 'item.available===false?"disabled":""' not in body
        assert "disabled=item.available===false" in body
        assert "정책 준수를 위해 Claude 구독 OAuth를 사용할 수 없습니다." in body
    finally:
        store.close()


def test_dashboard_serves_custom_svg_favicon(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
            response = client.get("/favicon.svg")
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/svg+xml"
        assert b"<svg" in response.content
        assert b'fill="#007aff"' in response.content
        assert b"M8.5 16h14" in response.content
        assert b"<circle" not in response.content
    finally:
        store.close()


def test_dashboard_hidden_attribute_cannot_be_overridden(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
            body = client.get("/dashboard").text
        assert "[hidden] { display: none !important; }" in body
    finally:
        store.close()


def test_dashboard_issues_automatic_http_only_session(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
            before = client.get("/v1/auth/status")
            dashboard = client.get("/dashboard")
            after = client.get("/v1/auth/status")

        cookie = dashboard.headers["set-cookie"]
        assert before.status_code == 401
        assert after.status_code == 200
        assert "llm_router_dashboard=" in cookie
        assert "HttpOnly" in cookie
        assert "SameSite=strict" in cookie
        assert dashboard.headers["cache-control"] == "private, no-store"
    finally:
        store.close()


def test_dashboard_session_can_be_refreshed_after_router_restart(tmp_path):
    first_store = UsageStore(tmp_path / "first.db")
    second_store = UsageStore(tmp_path / "second.db")
    keyless_settings = Settings(host="127.0.0.1", port=8787, _env_file=None)
    try:
        with TestClient(create_app(keyless_settings, REGISTRY, store=first_store)) as first_client:
            first_client.get("/dashboard")
            stale_cookie = first_client.cookies["llm_router_dashboard"]

        with TestClient(
            create_app(keyless_settings, REGISTRY, store=second_store)
        ) as second_client:
            second_client.cookies.set("llm_router_dashboard", stale_cookie)
            stale = second_client.get("/v1/auth/status")
            refreshed = second_client.post("/v1/dashboard/session")
            recovered = second_client.get("/v1/auth/status")

        assert stale.status_code == 401
        assert refreshed.status_code == 204
        assert "llm_router_dashboard=" in refreshed.headers["set-cookie"]
        assert "HttpOnly" in refreshed.headers["set-cookie"]
        assert recovered.status_code == 200
    finally:
        first_store.close()
        second_store.close()


def test_openai_account_gateway_failure_becomes_available_status():
    class FailingOpenAIAccountSource:
        async def report(self):
            raise RouterError(
                "OpenAI account credits request failed.",
                type="upstream_error",
                code="openai_account_upstream_error",
                status_code=502,
            )

    app = FastAPI()
    app.include_router(
        build_usage_router(
            None,
            lambda: None,
            openai_account_source=FailingOpenAIAccountSource(),
        )
    )

    with TestClient(app) as client:
        response = client.get("/v1/usage/account/openai")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert response.json() == {
        "object": "openai_account_usage",
        "status": "temporarily_unavailable",
        "source": "openai_chatgpt_usage_api",
        "configured": True,
        "stale": False,
        "message": "OpenAI account credits request failed.",
        "error_code": "openai_account_upstream_error",
        "rate_limits": {},
        "token_usage": {"summary": {}, "daily_usage_buckets": []},
    }
