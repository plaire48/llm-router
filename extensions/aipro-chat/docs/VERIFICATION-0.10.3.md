# 0.10.3 페이지 이미지 다운로드

검증일: 2026-09-21

## 변경

페이지에서 특정 이미지를 요청하면 `find_images`로 설명과 주변 문구를 확인하고 `attach_images`로 실제 파일을 채팅에 붙인다. 텍스트 모델도 이 도구를 사용한다. 모델에는 이미지 바이트와 서명 URL을 전달하지 않는다.

이미지 카드에는 미리보기, 짧은 이름과 오른쪽 다운로드 아이콘만 남겼다. localhost 같은 주소, 형식 배지, 중복 확대 아이콘과 다운로드 후 체크 표시는 제거했다. 이미지를 누르면 CX 확대 모달이 열리고 파일 형식, 해상도와 크기를 확인한다. 다운로드 시작은 토스트로 알리고 실패 시 재시도 안내를 유지한다.

원본 파일은 기존 캡처와 같은 IndexedDB에 보관한다. 대화 새로고침, 제공자별 대화 격리와 새 대화 삭제 정책을 공유한다. 파일당 20 MiB, 전체 80장 또는 80 MiB 제한이다. 원본을 가져올 수 없으면 오류를 반환하고 화면 캡처로 바꾸지 않는다. 실제 화면 캡처는 여전히 브라우저 탭으로 제한한다.

## 확인 결과

| 검증 | 결과 |
| --- | --- |
| `npm test` | 151개 통과 |
| `npm run design:check` | 문제 없음 |
| `npm run build` | 확장 폴더와 ZIP 생성 |
| `tests/page-images-browser.mjs` | 7개 시나리오 통과 |
| `tests/captures-browser.mjs` | 11개 시나리오 통과 |
| `tests/browser-agent-browser.mjs` | 14개 시나리오 통과 |

별도 Chrome 임시 프로필에서 DOM 이미지 선택부터 도구 실행, IndexedDB 저장, 채팅 표시와 실제 다운로드까지 확인했다. 테스트 서버와 모델 응답은 합성 데이터다. 회사망 AI Pro의 실제 모델 판단 성능은 포함하지 않았다.

- picture/currentSrc, CSS 배경 SVG, open shadow DOM, 미리 열린 외부 iframe 이미지
- WebP, PNG, SVG, JPEG 다운로드 파일의 바이트 일치와 이미지 미리보기
- 재요청을 거절하는 다른 origin의 이미지를 브라우저 리소스에서 가져오기
- blob/data 이미지와 GIF 파일, 바뀐 src와 허위 참조 거절, HTML 응답 거절
- 새로고침 이후 이미지 유지, 대화 삭제 시 파일 제거
- 360×800, 1100×850 카드와 320×480 확대 모달, 이미지 이동과 초점 복귀
- 기존 PNG 캡처의 실제 Chrome 사이드 패널 미리보기, 확대와 다운로드 회귀 검증

AVIF는 형식 식별과 브라우저 디코딩 경로를 제공하지만 실제 AVIF fixture의 다운로드는 이번 브라우저 검증에 포함하지 않았다. inline SVG DOM, Canvas 내보내기와 서버 최대 해상도 추측은 지원하지 않는다. 관찰 당시 페이지에서 선택한 이미지 파일을 가져온다.

## 구현 근거

Playwright CRX의 초기 외부 iframe 연결 상태에 의존하지 않도록 Chrome의 정적 isolated-world 스크립트로 이미지를 관찰한다. documentId와 관찰별 참조를 검사하므로 탐색 후 예전 요소로 파일을 가져오지 않는다. 기존 debugger 연결의 `Page.getResourceContent`로 로드된 파일을 우선 읽고, 동일 문서의 제한된 fetch로 보완한다. 일반 CDP 명령이나 fetch를 모델 스크립트에 공개하지 않는다.

공식 계약: [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [Chrome debugger와 프레임](https://developer.chrome.com/docs/extensions/reference/api/debugger#work-with-frames), [CDP Page.getResourceContent](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-getResourceContent).

## 로컬 검증 자료

- `verification/page-images-browser.json`
- `verification/page-images-360x800.png`
- `verification/page-images-1100x850.png`
- `verification/page-image-preview-320x480.png`
- `verification/captures-browser.json`
- `verification/browser-agent-browser.json`

검증 이미지와 JSON은 설치 ZIP에 포함하지 않는다.
