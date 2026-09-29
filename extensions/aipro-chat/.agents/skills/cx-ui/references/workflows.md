# 도입·구현 흐름

이 문서의 packageRoot는 lookup 출력의 실제 CX 패키지 경로다. 사용자가 요청한 흐름만 읽고 작업한다. 아래 CLI는 npm 예시이며 프로젝트의 기존 패키지 매니저를 우선한다.

## CX가 없는 프로젝트

스킬 설치와 디자인 패키지 설치는 별개다. 스킬만 읽었다고 React 컴포넌트를 import할 수는 없다.

1. 사용자가 전달한 CX 다운로드 폴더나 TGZ를 확인한다. 위치가 없으면 필요한 위치를 묻고 기존 화면 조사를 계속한다. 사내 주소나 최신 버전을 추측해 다운로드하지 않는다.
2. 기존 React 19 프로젝트는 TGZ를 vendor에 두고 `npm install ./vendor/<실제 파일명>.tgz`로 고정한다. 앱 진입점에 `@e2e/cx-design-system/styles.css`를 한 번 연결한다. 기존 의존성·라우터를 임의로 교체하지 않는다.
3. 새 앱은 제공된 CX 폴더의 `scripts/create.mjs`를 사용해 빈 대상에 생성한다. 템플릿 ID와 실제 TGZ 경로를 확인한 뒤 실행한다. 스킬도 설치하려면 사용자가 선택한 도구에 맞춰 --skill-target codex|claude|all을 명시한다. 생략하면 새 프로젝트에 스킬을 복사하지 않는다.
4. 비 React 앱은 제공된 `dist/styles.css`와 `dist/fonts/`를 상대 경로 그대로 배치한다. 변수만 필요하면 tokens.css와 fonts.css를 사용한다. JSON 기본값으로 반응형 CSS를 평탄화하지 않는다.
5. 조회가 가능해지면 `lookup.mjs <프로젝트> --summary`로 실제 연결을 확인한다. 사내 의존성 설치는 준비된 캐시/레지스트리를 따른다. 스킬 설치기 자체는 외부 다운로드를 하지 않는다.

## 새 앱과 새 화면

lookup의 library.templates에서 목적을 고른다. 프레임만 필요하면 app-shell, 검색·목록·상세 수정은 list-detail, 설정은 settings-form, 변경 비교는 history-list, 인증 진입은 login이 출발점이다. 모든 화면을 list-detail에 맞추지 않는다.

- 새 앱: `node <CX 폴더>/scripts/create.mjs <빈 대상> --template <ID> --package <TGZ>`.
- 기존 앱의 새 화면: `node <packageRoot>/scripts/template.mjs add <ID> --to <빈 화면 폴더>`.
- App.jsx와 app.css를 함께 연결한다. 기존 CxAppShell 안에서는 `embedded`를 전달한다. 복사한 화면은 서비스 코드이며 CX-TEMPLATE.json은 출처 기록이다.
- 목록·설정의 저장 콜백은 문서의 반환 형식에 맞는 서버 확인 객체를 반환한다. 실패·잘못된 결과에서는 초안을 남긴다.
- 초기값은 마운트 시점의 값이다. 데이터 조회 뒤 마운트하거나 대상 ID를 key로 사용한다. 단순 초기 props 변경을 서버 재조회로 취급하지 않는다.
- 로그인은 실제 onLogin과 세션 확인·화면 이동을 연결한다. 이력의 loadHistory는 안정된 콜백으로 연결하고 권한·취소·페이지 처리는 서비스에서 맡는다.

최소 로그인 조합은 다음과 같다. 기존 셸이 있는 곳에서는 내부 PageHeader와 버튼 부분만 사용한다.

```jsx
import React from 'react';
import '@e2e/cx-design-system/styles.css';
import { CxAppShell, CxPageHeader, ActionButton } from '@e2e/cx-design-system';

export default function LoginPage({ onLogin, busy = false }) {
  return (
    <CxAppShell brand="우리 서비스">
      <CxPageHeader title="로그인" actions={
        <ActionButton action="login" iconOnly={false} busy={busy} onClick={onLogin} />
      } />
    </CxAppShell>
  );
}
```

onLogin과 busy는 호스트가 제공한다. 이 예제 자체는 인증을 수행하지 않는다.

## 기존 화면 전환

먼저 현재의 라우트, 데이터 조회·저장 함수, 입력값, 권한별 버튼, 미저장 정책을 확인한다. 바꿀 요소를 CX API에 대응시킨 뒤 필요한 부분만 수정한다.

- 프레임·제목·구획: CxAppShell, CxPageHeader, CxCard.
- 동작: ActionButton, 일반 문구는 CxButton, 이동은 ActionLink.
- 입력: CxField와 CxInput/CxSelect/CxTextarea/CxCheckbox. 실제 입력까지 id·aria 연결이 전달돼야 한다.
- 검색: SearchField.onChange는 문자열, DateRangeFilter.onChange는 `{from,to}`를 전달한다.
- 상세·확인: DetailPanel, CxConfirmation. 닫기와 화면 이동에 기존 미저장 정책을 연결한다.
- 결과: CxNotice, useFeedback/notifyToast. 표·피드백의 자세한 동작은 각각의 계약을 읽는다.

기존 서비스의 동작 테스트를 먼저 활용한다. 시각 변경 때문에 데이터가 초기화되거나 기존 필터·정렬·페이지 상태가 누락되지 않았는지 확인한다. 다른 디자인 시스템과 혼합해야 하면 전역 CSS의 영향을 먼저 살피고 프로젝트 전체 전환으로 범위를 넓히지 않는다.

## 검토와 확인

검토 요청이면 바뀌어야 할 곳과 근거를 우선순위대로 전달한다. 구현까지 요청했으면 발견한 범위의 수정과 검증을 마친다.

| 변경 내용 | 핵심 확인 |
| --- | --- |
| 버튼·입력·색·타입 | 실제 계산 스타일, 이름·label, 좁은 화면·터치 조건, 긴 한국어 |
| 폼·저장 | 중복 실행 차단, 실패 시 값 유지, 재시도, 서버 성공 뒤 갱신 |
| 표 | 정렬·필터·선택·편집의 상태 소유자, 내부 스크롤, 열 고정·페이지 전환 시 일관성 |
| 모달 | 열기→Tab/해당 브라우저 탐색키→Esc/닫기→초점 복귀, 중첩·미저장 상태 |
| 토스트 | 약 3초·원 완성, 키보드/숨긴 탭 정지, 교체, 모션 감소, 모달·지속적 복구 경로 |
| 로그인 | 실제 콜백·busy·오류, 세션 확인 뒤 이동; 데모 클릭을 인증 성공으로 기록하지 않음 |

기존 검사 명령과 변경 지점의 의미 있는 테스트를 사용한다. 정적 검사·브라우저 확인·실제 서비스 연동을 구분해 결과를 기록한다. 새 화면이 사용 가능한 데 필요한 누락이 있으면 그 부분까지 마무리하고, 사용자 정보나 접근 권한이 필요한 연결만 구체적으로 남긴다.
