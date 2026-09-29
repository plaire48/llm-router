# Claude in Chrome 대비 시각 문맥과 바로가기 재점검

검토일: 2026-09-25. [기존 13개 경로 비교](CLAUDE-BROWSER-COMPARISON-2026-09-25.md)의 26/26은 그때 선정한 **기능 존재 범위**에만 적용한다. 이번에는 [Claude 공식 기능 안내](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)의 바로가기 예약과 화면 일부 공유를 현재 누비 소스에 다시 대조했다. [공식 Chrome Store](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn)의 1.0.94와 이전에 수집한 [배포본 manifest·해시](../verification/claude-comparison-2026-09-25/claude-package.json), [정적 식별자](../verification/claude-comparison-2026-09-25/claude-markers.json)를 사용했다. Claude 배포 JS의 재사용 라이선스는 확인되지 않아 코드를 복사하지 않았다. 정적 식별자만으로 내부 알고리즘이나 실행 성공을 주장하지 않는다.

점수는 **명시한 사용자 흐름별** 0=없음, 1=제한된 대체, 2=해당 경로 있음이다. D=Claude 공식 설명, S=배포본 정적 식별자, L=누비 로컬 Chrome 합성 검사다. 제품 총점, 실모델 정확도, 보안 동등성은 계산하지 않는다.

| 흐름 | Claude | 누비 이전 → 현재 | 판단 |
| --- | ---: | ---: | --- |
| 저장한 일반 프롬프트에서 바로 예약 폼 열기 | 2 D/S | 1 → **2 L** | 이름·요청과 연결된 페이지 URL 후보를 채운다. 시각·사이트 권한은 사용자 입력, 버튼만으로 예약/실행하지 않음 |
| 녹화한 절차를 예약 실행에 직접 결합 | 2 D | 1 → 1 | 누비 녹화 재실행과 예약은 각각 있음. 현재 예약은 녹화 절차 ID에 묶이지 않아 같은 동작을 보장하지 못함 |
| 사용자가 화면 일부를 직접 지정·첨부 | 2 D | 0 → 0 | Claude의 시각 공유 UX. 누비의 에이전트 영역 캡처는 사용자 선택 UI가 아니므로 동등하다고 채점하지 않음 |
| 시각 모델이 현재 뷰포트의 작은 영역을 따로 읽기 | — | 0 → **2 L** | 누비에 정수 CSS 좌표 `region` 캡처 추가. Claude 내부의 같은 도구 계약은 공개 근거가 없음 |
| 기기 간 대화 이어받기 | 2 D | 0 → 0 | Claude 계정·Cowork 서버 범위. 누비 로컬 확장의 대화 저장과 다른 운영 경계 |
| 실제 동일 업무 성공률 | 미측정 | 미측정 | 실제 Claude/누비 계정, 동일 사이트, 독립 정답과 반복 실행이 없음 |

## 반영 순서와 계약

1. **P1 완료 — 바로가기 예약.** 프롬프트 목록의 시계 아이콘에서 현재 예약 폼을 연다. 이미 저장한 이름/본문을 복사하고, 실제로 연결된 페이지가 있으면 그 URL을 편집 가능한 후보로 채운다. 이전 예약 ID를 계승하지 않는다. 사용자가 시각과 사이트 접근을 확인한 뒤 기존 `SAVE_BROWSER_ROUTINE` 경로로만 저장한다. 설정을 다시 열 때 오래된 바로가기 내용을 재적용하지 않는다.
2. **P1 완료 — 모델의 부분 시각 읽기.** 기존 [Playwright `page.screenshot`의 `clip`·`mask`](https://playwright.dev/docs/api/class-page#page-screenshot)을 재사용한다. `full_page:false`와 현재 뷰포트 안의 정수 `{x,y,width,height}`를 함께 요구한다. 스크롤 뒤에도 `clip`은 뷰포트 좌표로 지정하고, 결과 coverage에는 문서 좌표를 기록한다. PNG의 실제 크기, URL·스크롤·뷰포트 안정성, 16초 전체 기한과 취소를 기존 경로로 검사한다. 잘린 이미지 ID는 `click_at`에 사용할 수 없고 `visualTargets`도 내보내지 않는다. 비밀번호 등 기존 마스킹은 유지한다.
3. **P2 미완료 — 사용자 영역 지정 UI.** 에이전트의 작은 영역 조회와 사용자가 드래그해 설명 대상을 보내는 흐름은 다르다. 페이지 위 선택 UI, 접근성/키보드 대안, 현재 탭·마스킹·취소·이미지 소유권 검증이 있어야 한다. 현 코드에 이런 UI가 없으므로 완성으로 표시하지 않는다.
4. **P2 미완료 — 녹화 절차 예약 결합.** 저장 절차의 `steps`를 예약의 임의 프롬프트로 대체하면 검토한 녹화와 실행이 달라진다. 예약 레코드가 원본 절차 ID/버전과 소유 대화를 고정하고, 변경·삭제 시 명시적으로 중단하며, 실행 시 기존 `workflowPrompt`와 관찰·승인 경로를 그대로 써야 한다. 현재 그 계약이 없어 버튼을 추가하지 않았다.
5. **평가 미완료 — 실모델·실사이트.** 합성 Chrome은 영역 픽셀, 양식, 알람 계약을 검증하지만 Claude와 Qwen의 실제 업무 성공률, 서버 저장 영수증, Windows/Edge 계정 동작을 측정하지 않는다. 기존 [품질 작업 목록](../quality-work.json)의 NQ-02/04/07/08이 별도 조건이다.

## 공개 방법론과 오픈소스 선택

| 후보 | 판단 |
| --- | --- |
| 기존 `@playwright-repl/playwright-crx`와 Playwright screenshot API | **재사용.** 현재 번들에 있고 라이선스는 Apache-2.0. `clip`을 원본 캡처 경로에서 적용해 별도 바이너리 이미지 편집 의존성 없이 정확한 크기/마스킹 계약을 유지한다. |
| 기존 Chrome alarms·storage·permissions | **재사용.** 바로가기 클릭은 예약 초안만 만들고 사용자 제출 시에만 기존 정책·권한·알람 경로를 통과한다. |
| 브라우저 Canvas 후처리 또는 새 이미지 크롭 패키지 | **미도입.** 기존 Playwright가 원본 PNG 생성 단계에서 `clip`을 제공한다. 두 번째 픽셀 처리·메모리 복사를 추가할 품질 근거가 없다. |
| Claude 배포 CRX | **비채택.** 비교 근거로만 사용했다. 재사용 허가가 확인되지 않아 코드·자산을 편입하지 않았다. |

## 검증 범위

- 단위: 캡처 인자/크기/취소/기한, 전체·뷰포트·일부 coverage, facade의 임의 옵션 거부.
- 실제 Chrome 합성 페이지: 저장 프롬프트 클릭→편집 가능한 예약 폼, 예약 자동 생성 0건, 360px 가로 넘침 없음. 스크롤된 화면의 지정 색상 픽셀·비밀번호 마스킹·잘린 이미지 클릭 차단.
- [동일 후보 핵심 품질 보고서](../verification/pre-release-2026-09-25T12-25-31-008Z/report.json)는 **90/90단계 통과**다. 단위 868/868, 디자인·후보 빌드, 고정 Chrome 경로의 3회 반복과 단발 검사가 포함된다. 보고서는 `quality-baseline-v5`, `actualBrowser=true`, `syntheticSite=true`, `actualModel=false`, `liveAccount=false`, `releaseApproved=false`를 기록한다. `quality:status`가 이 보고서를 현재 소스의 핵심 근거로 찾았다. 실계정 Claude/Qwen, 회사 사이트 등록·저장, 사용자 영역 지정 UX, 녹화 절차의 예약 연결은 이 검사로 입증되지 않는다.
- [화면 아이덴티티 보고서](../verification/pre-release-2026-09-25T12-47-45-938Z/report.json)는 **33/33단계 통과**다. 두 보고서의 검증 입력 해시와 빌드 SHA-256 `397a76963a1c951e0f249fd258147f7c358f07e03f6c976e98a1ab7dfcb6cc50`가 같다. 360px 예약 폼 [실제 Chrome 이미지](../verification/prompt-shortcuts/schedule-from-shortcut-360.png)도 확인했다. 로컬 후보 ZIP은 설치나 공개 배포가 아니다.
