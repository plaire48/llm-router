# 열린 PDF 텍스트 읽기

현재 누비가 소유한 최상위 PDF 탭을 기존 `read_page(mode="content")`로 읽도록 연결했다. 현재 탭의 실제 문서 ID를 확보한 뒤 공개 원문을 가져오고, 기존 PDF.js로 페이지별 텍스트를 추출한다. 모델이 임의 URL을 전달하는 새 도구는 만들지 않았다.

## 적용 근거와 경로

| 판단 | 적용 | 경계 |
| --- | --- | --- |
| 기존 라이브러리 재사용 | Apache-2.0 `pdfjs-dist` 6.3.289의 `getDocument`, `getPage`, `getTextContent`를 공통 코어로 분리 | 기존 첨부 PDF와 열린 PDF가 같은 추출 옵션을 사용한다. 새 패키지나 필수 외부 실행기는 없다 |
| 문서 귀속 | 실제 소유 탭, 최상위 frame, scripting documentId, PDF MIME, 관찰 URL을 원문 가져오기 전후와 파싱 후 대조 | 동일 URL만으로 문서 일치를 추정하지 않는다. iframe PDF는 첫 지원 범위에서 제외한다 |
| 공개 원문 제한 | 기존 정책과 host permission 확인, 인증 유사 URL 거부, `credentials:omit`, redirect 거부, MIME과 PDF signature 확인 | 인증이 필요한 PDF, 쿠키 의존 원문, 임의 URL 가져오기와 권한 추가는 지원하지 않는다 |
| 실행 수명 | 기존 이미지 비교와 PDF가 같은 offscreen 직렬 큐를 사용 | Chrome의 단일 offscreen 문서 제약을 따르고 취소/마감 뒤 문서와 Worker를 정리한다 |
| 부분 근거 | 원문 SHA-256, 실제 페이지 수, 페이지별 텍스트 범위, 빈 페이지, 제한된 반환 범위를 보존 | 파싱한 전체 페이지가 모델의 전체 열람이나 사실 검증을 뜻하지 않는다 |

[PDF.js 공식 예제](https://mozilla.github.io/pdf.js/examples/), [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen), [확장 네트워크 요청](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)을 기준으로 기존 소스를 재사용했다. `browser-content` 번들은 `background-images`와 `browser-url`을 외부 모듈로 공유한다. 이를 복제 번들하면 offscreen 큐 또는 호스트가 초기화한 정책을 공유하지 못한다. PDF Worker와 기존 폰트/CMap 자산은 배포 패키지에 함께 포함한다.

## 한도와 실패 처리

원본 8MiB, 2,000페이지, 추출 UTF-8 12MiB 한도를 유지한다. 브라우저 반환 경로는 기존 offset 계약에 맞춰 최대 2백만 문자로 제한한다. 원문 가져오기/스트림은 15초, 파서는 120초, 전체 원문 읽기는 135초 기한을 둔다. 사용자 취소는 전파하며 멈춘 스트림 정리를 기다리느라 결과 반환을 막지 않는다.

같은 실행의 캐시는 문서 ID와 원문 URL에 묶이고 120초 후 만료한다. 캐시 사용 전에도 문서와 권한을 재확인한다. 재조회 시각을 모델 반환 근거에 넣지 않아 같은 원문 해시와 같은 텍스트를 다시 가져온 것만으로 복구 진전을 만들지 않는다.

암호, 텍스트가 없는 스캔, 잘못된 PDF, 크기 초과, 권한 부족, 리다이렉트, 응답 오류와 마감은 명시적 미열람 결과다. 같은 PDF 읽기/캡처를 바꾸지 않고 반복하지 않도록 안내한다. 원문이 필수이면 한계를 표시하거나 원본 첨부를 요청하고, 선택한 조사 방법이면 이미 관찰한 다른 자료로 원래 요청을 이어간다. 이 안내는 자동 완료나 계획 범위 삭제가 아니다.

PDF 양식 입력/편집, OCR, 이미지와 표 구조, 레이아웃 검증은 이번 지원에 포함하지 않는다. 새로 가져온 원문 해시는 이 원문 스냅샷의 식별자이며, 이미 Chrome 뷰어가 그린 바이트나 브라우저 행동 성공의 증명이 아니다.

## 검증 기록

- 관련 소스 단위 51개 통과. 문서 교체, 캐시 권한 철회, 인증/리다이렉트/잘못된 MIME, 바이트 한도, 파서 실패, 멈춘 스트림, 취소, 같은 원문 재조회 시 진전 불변을 포함한다.
- 격리 Chrome의 로컬 PDF 6개 흐름 통과. 실제 documentId, 원문 해시, 부분 읽기와 이어 읽기, 빈 페이지, 동일 URL 재로드, 이미지 비교와 PDF 동시 요청의 큐 공유, 정지 뒤 offscreen 정리를 확인했다. [Chrome 기록](../verification/browser-pdf/browser.json). 이 파일의 `sourceOverlay` 값으로 실제 배포 번들과 임시 소스 번들을 구분한다.
- 공개 원문 격리 검사는 모델을 호출하지 않았다. [공개 PDF 기록](../verification/browser-pdf/public-pdf.json). FIE의 과거 관찰 URL은 HTTP404와 `application/problem+json`으로 PDF 원문이 없었다. 23문자 오류 본문 읽기는 PDF 추출 성공이 아니다. Mozilla PDF.js 예제는 HTTP200/PDF, 14페이지, 84,684문자 추출을 607ms에 완료했다. 반환한 첫 범위만 모델에 제공하는 계약이며, 전체 모델 열람/정확도/요청 완료는 미측정이다.

공개 원문 검사는 임시 소스 번들과 테스트용 두 원문 host permission을 사용했다. 제품 권한이나 실제 평가 프로필을 바꾸지 않았다. 최종 배포 번들 반복 Chrome 검사와 실제 ChatGPT SSO 요청의 완료율은 통합 검증/새 후보 실측에서 별도로 판정한다.
