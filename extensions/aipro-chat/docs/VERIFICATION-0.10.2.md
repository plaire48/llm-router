# 0.10.2 브라우저 캡처

검증일: 2026-09-21

## 변경

Qwen의 `capture_page`와 Playwright 스크립트의 `browser.screenshot()`에서 생성한 이미지를 답변 아래에 표시한다. 스크립트 한 번에서 여러 장을 캡처해도 각각 보관한다. 모델 입력에는 기존처럼 최신 이미지 한 장만 전달한다.

흰 이미지 카드와 옅은 배경, CX 아이콘, 확대 모달을 사용한다. 원본 크기, 화면 맞춤, 이전/다음 이미지와 PNG 다운로드를 제공한다. 다운로드는 시작 알림과 체크 아이콘으로 표시하고 실패하면 재시도 안내를 남긴다. 사용자 HTML의 공유 디자인 토큰과 모션 감소 설정을 유지한다.

캡처는 연결된 브라우저 탭의 현재 뷰포트만 대상으로 한다. 데스크톱 캡처 권한이나 다른 앱 캡처 API를 추가하지 않았다. 알려진 비밀 입력란은 중립색으로 가린다.

이미지는 확장 IndexedDB에 저장하고 대화에는 참조와 안전한 표시 정보만 보관한다. 새 대화를 시작하면 해당 이미지도 삭제한다. 다른 제공자의 대화는 유지한다. 전체 80장 또는 80MiB 한도에서 기존 이미지를 임의로 삭제하지 않고 저장 실패를 알린다.

## 확인 결과

| 검증 | 결과 |
| --- | --- |
| `npm test` | 147개 통과 |
| `npm run design:check` | 문제 없음 |
| `npm run build` | 확장 폴더와 ZIP 생성 |
| `tests/captures-browser.mjs` | 11개 시나리오 통과 |
| `tests/browser-agent-browser.mjs` | 기존 자동화 14개 시나리오 통과 |

캡처 시나리오는 실제 PNG 생성, 알려진 비밀 입력란 마스킹, 도구 실행 중 이미지 표시, 원본과 다운로드 파일의 바이트 일치, 저장 공간 한도, 누락 이미지 재시도, 다운로드 실패 복구, 새로고침, 브라우저 재시작과 재인증, 대화 삭제를 포함한다.

일반 탭의 320×480, 360×800, 1100×850 화면과 실제 Chrome 사이드 패널을 확인했다. 사이드 패널에서도 확대와 실제 파일 다운로드를 검증했다. 모달 초점 복귀, 키보드 이동, 모션 감소와 작은 화면의 하단 조작 영역을 확인했다.

브라우저 테스트는 별도 임시 프로필과 사이트 권한을 부여한 설치 복사본을 사용했다. 모델 응답과 웹사이트는 합성 데이터이며 캡처, Playwright 조작, IndexedDB 저장과 다운로드는 실제 Chrome 동작이다. 회사망 AI Pro SSO와 실제 Qwen 이미지 판단 성능은 이번 검증에 포함하지 않았다.

## 검증 자료

- `verification/captures-browser.json`
- `verification/browser-agent-browser.json`
- `verification/capture-single-360x800.png`
- `verification/capture-single-1100x850.png`
- `verification/capture-native-side-panel.png`
- `verification/capture-preview-320x480.png`

검증 이미지와 JSON은 로컬 산출물이며 설치 ZIP에 포함하지 않는다.
