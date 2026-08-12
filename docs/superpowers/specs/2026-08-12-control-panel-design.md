# LLM Router 데스크톱 콘솔 설계

## 제품 중심

제품의 중심은 대시보드가 아니라 **LLM 서빙 관리**다. 흰색 데스크톱 앱 형태로 다음 세 메뉴를
제공한다.

1. 연결
2. LLM 서빙
3. 대시보드

## 연결

Claude와 OpenAI 로그인 버튼을 각각 하나씩 제공한다.

- Claude는 공식 Claude Code CLI의 `claude auth login --claudeai`와 `claude auth status --json`을
  사용한다.
- OpenAI는 공식 Codex CLI의 `codex login`과 Codex 인증 저장소를 사용한다.

별도 라우터 전용 OAuth 저장소를 로그인 상태의 기준으로 사용하지 않는다.

## LLM 서빙

사용자는 UI에서 프로필을 추가·편집·삭제한다. 프로필 필드는 다음과 같다.

- 프로필 이름
- 연결 방식: Claude OAuth, OpenAI OAuth, Anthropic API key, OpenAI API key, 사내 OpenAI 호환
- 업스트림 모델 ID
- 사내 연결의 Base URL
- localhost 포트
- API key 연결의 비밀 키

저장 후 시작하면 `http://localhost:<port>/v1`이 열린다. 포트 서버는 관리 서버의 OpenAI 호환
라우터로 TCP 전달하며, opencode는 생성된 주소에 연결하는 클라이언트다.

API key는 `profiles.yaml`과 API 응답에 기록하지 않는다. 0600 로컬 비밀 저장소에 저장하고 런타임
환경변수로만 주입한다.

## 대시보드

대시보드는 별도 메뉴이며 다음 핵심 정보만 표시한다.

- 연결 계정 수
- 실행 중 프로필 서버 수
- 최근 7일 요청과 토큰
- 계정 사용 창이 제공되는 경우 한도 대비 사용률
- 일별 입력·출력 토큰

## 인증

대시보드에는 키 입력 화면이 없다. `GET /dashboard`가 HttpOnly·SameSite=Strict localhost 세션을
자동 발급한다. `LLM_ROUTER_MASTER_KEY`는 opencode와 OpenAI 호환 API 호출에만 사용한다.

## API

- `GET /v1/auth/status`
- `POST /v1/auth/{anthropic|openai}/login`
- `DELETE /v1/auth/{anthropic|openai}`
- `GET /v1/profiles`
- `POST /v1/profiles`
- `PUT /v1/profiles/{name}`
- `DELETE /v1/profiles/{name}`
- `POST /v1/profiles/{name}/{start|stop}`
- `POST /v1/profiles/discover-models`
- `GET /v1/connect/opencode`
- `GET /v1/usage/summary`
- `GET /v1/usage/account/openai`
