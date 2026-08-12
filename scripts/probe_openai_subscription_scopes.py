#!/usr/bin/env python3
"""ChatGPT 구독 로그인 토큰이 OpenAI 플랫폼 API를 열 수 있는지 확인한다.

사내 Enterprise 계정으로 이 질문을 확정하기 위한 스크립트다.
Codex CLI에 이미 로그인돼 있어야 한다 (`~/.codex/auth.json`).

    python3 scripts/probe_openai_subscription_scopes.py

토큰 값은 절대 출력하지 않는다. 스코프와 응답 상태만 보여준다.
"""

from __future__ import annotations

import base64
import json
import pathlib
import sys
import time

try:
    import httpx
except ImportError:
    sys.exit("httpx가 필요합니다:  python3 -m pip install httpx")

AUTH_PATH = pathlib.Path.home() / ".codex" / "auth.json"


def claims(jwt: str) -> dict:
    payload = jwt.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


def main() -> int:
    if not AUTH_PATH.exists():
        return fail(f"{AUTH_PATH} 없음. 먼저 Codex CLI로 ChatGPT 로그인을 하세요.")

    auth = json.loads(AUTH_PATH.read_text())
    mode = auth.get("auth_mode")
    tokens = auth.get("tokens") or {}
    access = tokens.get("access_token")
    account_id = tokens.get("account_id")

    print(f"auth_mode        : {mode}")
    print(f"OPENAI_API_KEY   : {'설정됨' if auth.get('OPENAI_API_KEY') else '없음 (구독 인증)'}")
    if mode != "chatgpt" or not access:
        return fail("ChatGPT 구독 인증 상태가 아닙니다. 이 스크립트는 그 경우만 확인합니다.")

    payload = claims(access)
    scopes = payload.get("scp") or []
    openai_auth = payload.get("https://api.openai.com/auth") or {}
    expired = time.time() > payload.get("exp", 0)

    print(f"plan_type        : {openai_auth.get('chatgpt_plan_type')}")
    print(f"organizations    : {len(openai_auth.get('organizations') or [])}개")
    print(f"token expired    : {expired}")
    print(f"client_id        : {payload.get('client_id')}")
    print(f"audience         : {payload.get('aud')}")
    print(f"granted scopes   : {scopes}")
    print()

    if expired:
        return fail("토큰이 만료됐습니다. Codex CLI에서 다시 로그인한 뒤 재실행하세요.")

    inference_scopes = [s for s in scopes if any(k in s for k in ("model", "responses", "api."))]
    if inference_scopes:
        print(f"→ 추론 관련 스코프가 보입니다: {inference_scopes}")
    else:
        print("→ 추론 관련 스코프가 없습니다 (신원 확인용만).")
    print()

    headers = {"authorization": f"Bearer {access}"}
    if account_id:
        headers["chatgpt-account-id"] = account_id

    probes = [
        ("GET", "https://api.openai.com/v1/models", None),
        ("POST", "https://api.openai.com/v1/chat/completions",
         {"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "OK"}], "max_tokens": 5}),
        ("POST", "https://api.openai.com/v1/responses",
         {"model": "gpt-4o-mini", "input": "OK"}),
    ]

    any_ok = False
    for method, url, body in probes:
        label = f"{method} {url.removeprefix('https://api.openai.com')}"
        try:
            response = httpx.request(method, url, headers=headers, json=body, timeout=30)
        except Exception as exc:  # noqa: BLE001 - probe should never crash
            print(f"{label:<34} ERR  {type(exc).__name__}: {exc}")
            continue
        detail = response.text[:150].replace("\n", " ")
        print(f"{label:<34} {response.status_code}  {detail}")
        if response.status_code < 300:
            any_ok = True

    print()
    if any_ok:
        print("결론: 이 계정의 구독 토큰으로 플랫폼 API 호출이 가능합니다.")
        print("      llm-router에 OpenAI 구독 OAuth 경로를 구현할 수 있습니다. 위 결과를 공유해 주세요.")
    else:
        print("결론: 구독 토큰으로는 플랫폼 API를 호출할 수 없습니다 (인증은 통과, 인가에서 거부).")
        print("      OpenAI는 API key 경로를 사용해야 합니다.")
    return 0


def fail(message: str) -> int:
    print(f"중단: {message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
