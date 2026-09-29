# FabriX 연결과 OpenAI 호환 변환

기준은 LLM Router의 `src/llm_router/adapters/fabrix.py`와 해당 계약 테스트입니다. 0.13.3은 OpenWiki 사내 어댑터에서 수정한 형식 교정 방식을 확장에 적용합니다. Python 라우터나 Agent Factory SDK는 수정하지 않습니다.

## 연결

FabriX 버튼은 CX 모달을 엽니다. Endpoint, Client Key와 API Token을 입력하고 연결 테스트 후 등록합니다. 테스트는 GET `{base}/chat/v1/models`의 인증과 모델 목록 형식을 확인하며 추론 요청은 보내지 않습니다. 연결 후 입력창 아래 모델 선택에서 고릅니다. 화면은 `name`의 `languageCode: ko` 이름을 우선 표시하고, 요청은 선택한 `modelId`를 사용합니다. 기존 선택이 목록에 있으면 유지하고, 없으면 서버 순서의 첫 모델을 선택합니다. 모델 유형이나 도구 설명으로 목록을 필터링하지 않습니다.

설명의 `[Context]` 용량이 있으면 컨텍스트 표시에 사용하며 없으면 미제공으로 둡니다. 4096 토큰은 내부 출력 예산으로, 제공자의 최대 출력 한도를 의미하지 않습니다.

HTTPS 주소의 필요한 origin만 사용자 조작에서 접근 허용을 요청합니다. 인증값은 trusted session에만 보관하며 페이지 도구, 진단과 local 저장소에 전달하지 않습니다. 취소와 이전 테스트의 늦은 응답은 연결을 갱신할 수 없습니다. 설정 변경 시 다시 테스트해야 합니다.

## 변환

- 기본 주소에 `/chat/v1/messages`를 붙입니다. 호스트만 입력하면 기존 `/openapi` 기본 경로를 사용합니다. 완성된 messages/models URL도 정규화합니다. `x-fabrix-client`와 `x-openapi-token: Bearer ...` 헤더를 사용합니다.
- OpenAI messages/model/max_tokens를 FabriX contents/systemPrompt/modelIds/llmConfig로 변환합니다. system, user, assistant와 tool 결과의 역할과 호출 연결 관계를 유지합니다.
- camelCase와 snake_case SSE를 처리하고 THINK 원문은 저장하거나 표시하지 않습니다. CHUNK content, 종료 상태, 필터와 실제 usage만 정규화합니다.
- 기존 라우터의 확인된 계약에는 native function calling 필드가 없습니다. 따라서 활성 도구의 스키마와 요청별 응답 계약을 systemPrompt로 전달하고, 모델의 구조화된 결과를 검증해 OpenAI tool_calls로 변환합니다. 일반 문장이나 페이지에 포함된 JSON을 임의로 실행하지 않습니다.
- 변환 후 기존 Pi 실행기, 도구 허용 목록과 인자 검사, 페이지 권한, Playwright, 취소, 컨텍스트 압축, 작업 이어가기와 사용량 기록을 공유합니다.
- 응답에 없는 토큰 수와 모델 한도는 만들지 않습니다. 실제 FabriX 모델의 구조화 응답 능력은 사용자 환경의 대화와 도구 실행에서 별도로 확인합니다. 확인된 FabriX 입력 계약은 텍스트이며 이미지 입력을 지원한다고 표시하지 않습니다.

응답은 계약 전체를 검증한 뒤 OpenAI JSON 또는 SSE로 반환하므로 현재 UI에는 한 번에 표시됩니다. 이는 native function calling이나 실시간 델타 전달을 보장하는 서버가 아니라, 확장 내부의 Chat Completions 변환 계층입니다. 지원하는 tool_choice는 auto와 none입니다.

## 형식 오류 복구

이전 버전은 정상 JSON 전체에 Markdown 코드 블록이 붙어도 fabrix_tool_protocol로 실패했습니다. 0.13.3은 응답 전체를 감싼 코드 블록만 제거합니다. 일반 설명, 추론 문장이나 여러 객체 사이에서 실행할 JSON을 추출하지 않습니다. 현재 요청 ID, 등록된 도구 이름, 인자 객체와 호출 수를 검사한 뒤 기존 Pi의 인자 스키마 검사를 거쳐 실행합니다.

형식 검증 실패는 한 번만 다시 요청합니다. 원래 대화와 작업 제약을 유지하고 새 요청 ID와 고정된 실패 사유를 전달합니다. 실패한 응답 원문은 다음 프롬프트나 기록에 넣지 않으며 그 응답의 도구를 실행하지 않습니다. 문서 작성 형식은 content나 arguments 안에 넣도록 명시합니다. 두 번째 실패는 사용자에게 반환합니다. 취소, 실제 HTTP 오류, 필터와 출력 길이 제한은 이 재시도를 하지 않습니다. SSE END 프레임의 종료 사유도 확인합니다.

fabrix_tool_protocol은 확장 내부의 모델 형식 오류이며 HTTP 502를 만들지 않습니다. 실제 서버가 502를 반환하면 upstream과 HTTP 502로 기록합니다. 채팅의 형식 진단은 fabrix_format_retry/recovered/failed, invalid_json/invalid_protocol/request_id_mismatch/invalid_envelope/unknown_tool/invalid_arguments, 시도 번호와 실제 성공 HTTP 상태만 저장합니다. 토큰, 도구 인자와 응답 원문은 포함하지 않습니다.

교정 요청은 별도 호출로 사용량을 기록합니다. 누적 사용량에는 실패한 요청이 보고한 토큰도 포함하고, 해당 요청에 usage가 없으면 미집계로 남깁니다. 컨텍스트에는 마지막 성공 요청의 토큰만 사용합니다. 누적 SSE usage 프레임과 최종 OpenAI usage를 중복 합산하지 않습니다.

사용자 설정 Endpoint를 지원하기 위해 CSP의 connect-src는 HTTPS를 허용합니다. 실제 접속은 optional host permission에서 해당 origin을 허용받아야 하며 테스트와 연결 직전에 확인합니다. 원격 실행 코드, 인증서 검증 해제, HTTP fallback은 추가하지 않습니다.

검증 범위는 [0.16.1 검증 기록](VERIFICATION-0.16.1.md)에 있습니다. 실제 FabriX 인증값이나 회사망 응답은 이 환경에서 검증하지 않았습니다.
