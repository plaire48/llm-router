# URL 검증 실패 설명과 계약 정합성

다음 후보의 소스에 한정한 변경이다. 실측 중인 SHA-256 `73df3abc3d4a42735a734de46a1f16a4772269718a6944cd55ff25180b8f964f` 후보, 평가 스크립트, 빌드와 생성 산출물은 수정하지 않았다.

기존 `verify_page` 설명은 origin/path 비교, `wait_page` 설명은 정제된 URL 비교로 읽혔다. 실제 검증은 query와 fragment를 포함한 정규화된 전체 HTTP(S) href 일치였다. 정확도 조건은 그대로 두고 설명과 복구 피드백을 실제 구현에 맞췄다.

- `compareBrowserURL`은 기대/실제 URL의 유효성과 허용 범위를 확인하고 origin, path, query, fragment 순서에서 첫 불일치를 고정 reason으로 반환한다. 전체 href가 다르면 모두 통과하지 않는다. 빈 query/fragment 구분처럼 구성요소만으로 설명할 수 없는 차이는 `url_identity_mismatch`다.
- 기대 URL, 실제 URL, query 이름/값, fragment와 인증값은 반환하지 않는다. 정제 표시 URL이 같아지는 불일치는 모델 응답에 `redactedDifference:true`만 보낸다. 진단에는 기존 kind/passed/reason 필드만 남긴다.
- 실제 `verifyPage`와 조건부 `wait_page`에 고정 reason을 연결했다. `completion-errors.js`는 허용된 reason만 보존하고 임의 문자열과 원문을 버린다.
- 모델에는 정제 URL을 완전 URL로 추측해 재구성하지 말고 원래 요구사항에 맞는 관찰 검증을 선택하도록 안내한다. 명시적으로 요구한 URL/리소스 조건을 제거하거나 실패를 성공으로 바꾸지 않는다. URL 검증 실패만으로 이전 쓰기를 재전송하지 않으며, 필수 정보나 사용자 선택을 묻는 기존 경로는 유지한다.

## E01 근거의 한계

73df3a 후보 E01에는 URL 검사만 실패하고 다른 본문 검사는 통과한 기록이 있다. 종료 시 작업 탭 URL에는 네이버 검색 query와 추가 매개변수가 있었다. 하지만 실패 시 기대 URL과 구성요소 차이가 기존 진단에 없어 query가 직접 원인이었다고 확정할 수 없다. 종료 시 URL은 실패 순간의 URL과 동일하다고 보장되지 않는다. 원본 `sourceFinalUrl`을 작업 탭 실제 URL로 해석하지 않는다. 이번 소스 변경을 진행 중인 후보 실측의 복구나 성공 근거로 사용하지 않는다.

## 검증

새 `tests/browser-url-feedback.test.mjs`는 실제 URL 비교 helper와 AST로 추출한 실제 `verifyPage` 및 조건부 대기 코드를 실행한다. 브라우저 전송은 테스트 더블이며 Chrome/실모델 검증은 아니다.

- URL/피드백/진단/복구/액션 발행 경계/관리 정책 관련 소스 검사 46개 통과.
- 스킬 및 도구 선택 관련 소스 검사 6개 통과.
- query 값, 순서, 중복 query, fragment, 표시 URL의 동일성, 유효하지 않은 URL과 금지 URL을 확인했다. 전체 href 정확 일치와 text 통과/URL 실패의 독립 결과를 유지했다.
- 반환값과 진단에 비밀값이 없고, 조건부 대기가 최종 검증 성공을 선언하지 않는지 확인했다.

후보 빌드와 실제 Chrome 회귀는 실행 중 실측이 종료된 뒤 통합 단계에서 수행해야 한다. 이번 검사는 실서비스 과제 완료율 개선을 입증하지 않는다.
