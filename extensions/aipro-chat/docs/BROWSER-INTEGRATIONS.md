# 브라우저 연결과 저장

누비 확장만으로 MCP 연결, 브라우저 JavaScript 스킬 실행, JSM 티켓 수집과 폴더 저장을 제공합니다.

## MCP

설정의 **MCP 연결**에서 이름과 HTTP/HTTPS 주소를 입력합니다. 필요한 경우 `Authorization: Bearer …`, `X-API-Key`, 업무용 사용자 지정 헤더를 추가합니다. 연결 버튼은 실제 초기화와 도구 목록 조회가 성공한 뒤 저장합니다.

공식 TypeScript SDK 1.30.0의 Streamable HTTP를 사용합니다. stdio, 구형 SSE transport, OAuth 자동 로그인은 지원하지 않습니다. 헤더와 연결 정보는 Chrome trusted session storage에만 남고 브라우저 종료 시 사라집니다. 수정 시 비밀값을 다시 입력합니다. 등록 호스트의 접근 허용이 필요하며 각 호출에서도 권한을 검사합니다. endpoint redirect, 브라우저 쿠키 첨부, 자동 호출 재시도는 하지 않습니다. 서버 주소의 query/hash/userinfo 인증값은 거부합니다.

에이전트는 도구 목록과 스키마를 읽고 정확한 인자를 제안합니다. 사용자 승인 화면은 서버, 도구와 전달 내용을 보여줍니다. 승인은 대화/모델 계정/연결/도구 정의/인자에 묶이고 호출 전에 소비됩니다. 도구 정의 변경, 만료, 연결 해제는 실행을 막습니다. 호출 뒤 응답이 끊기면 unknown으로 처리하고 자동 재호출하지 않습니다. 서버의 readOnlyHint는 승인 근거로 신뢰하지 않습니다.

연결/호출은 전체 20초, 응답 1 MiB, 목록 100개/10페이지 제한이 있습니다. 반환 자료는 제한된 발췌이며 임베디드 이미지/리소스 URL을 자동으로 열지 않습니다. 장시간 MCP 작업과 MCP task 확장은 후속 범위입니다.

## 폴더 스킬

기존 스킬 가져오기에서 SKILL.md가 들어 있는 폴더를 선택합니다. `scripts/*.browser.js`만 실행 가능하며 [예시](../examples/skills/fill-title/SKILL.md)를 제공합니다. JSON input과 제한된 page/browser API를 기존 QuickJS VM에 전달합니다. 외부 네트워크, Node, Python, Chrome API, 임의 파일 시스템과 라이브러리 설치는 허용하지 않습니다.

스킬의 내용 해시를 요청 시작 시 묶습니다. 실행 중 변경하면 새 요청이 필요합니다. 기존 브라우저의 요소 검사, 부분 실행 기록, 최종 승인과 별도 결과 검증을 그대로 사용합니다. 입력 포함 최대 20,000자이며 다른 스크립트/Markdown 코드 블록은 참고 자료입니다.

## JSM/VOC

`/browse/KEY-123` 또는 `/servicedesk/customer/portal/숫자/KEY-123` 형태의 티켓에서 실제 렌더된 제목과 본문을 수집합니다. 페이지 읽기/이동은 기존 브라우저 도구를 사용하고, 수집한 티켓은 검색 → 필요한 줄 읽기로 재사용합니다. 가상 스크롤, 접힌 댓글, 다른 페이지, 권한으로 가려진 정보까지 수집한 것으로 표시하지 않습니다. API 전체 수집이나 JSM Cloud/Data Center 모든 커스텀 화면 호환을 보장하지 않습니다.

출처 origin+티켓 키로 묶고 원문 해시로 중복과 개정을 구분합니다. 수집 시간과 원격 수정 시간을 구분하며 추정 값을 원격 사실로 채우지 않습니다. AI 요약은 채팅에서 출처와 함께 제공하며 보관 원문을 대체하지 않습니다.

첨부는 실제 티켓에 존재하는 같은 사이트 링크에서 5 MiB까지 가져옵니다. 외부 링크, 서명 query 링크, redirect, 로그인 HTML은 보관하지 않습니다. 바이너리 원본 보관과 문서 분석은 별개입니다. 내려받은 PDF/Word를 분석하려면 기존 채팅 첨부 기능을 사용합니다.

설정의 **저장 폴더**는 OpenWiki 폴더와 별개입니다. 사용자가 선택한 readwrite directory handle만 저장합니다. 새로 시작한 대화에서 해당 폴더를 사용하며 권한이 만료되면 설정에서 다시 허용합니다. 브라우저가 사이드 패널의 picker를 허용하지 않으면 전체 화면에서 선택합니다.

`nubi-voc/티켓해시/개정해시/` 아래 record.json, record.md, 내려받은 첨부, 내용 해시 manifest를 저장합니다. close 후 파일을 다시 읽어 해시를 확인합니다. 동일한 바이트는 재사용하고 다르면 충돌을 보고합니다. 사용자 수정 파일을 덮어쓰지 않습니다. File System Access는 폴더 전체 원자적 트랜잭션이 아니므로 중단 시 일부 파일이 남을 수 있으며 성공 영수증은 전체 검증 후에만 반환합니다. 동시 외부 파일 편집까지 잠그지는 않습니다.

A2A, Desktop 자동 동기화, 임의 PC 경로 접근, 스케줄 기반 무인 크롤링은 추가하지 않았습니다. 브라우저 저장과 PC 폴더 저장은 별도의 완료 상태입니다.

## 검증 경계와 참고

실제 Chrome의 합성 MCP/JSM 사이트, 공식 SDK, QuickJS, IndexedDB와 실제 FileSystemDirectoryHandle로 검증합니다. OPFS handle 검사는 OS 폴더 선택 창의 승인이나 실제 회사 서버 성공을 증명하지 않습니다.

- [공식 MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk): transport 및 프로토콜 처리를 재사용합니다.
- [Chrome File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access): 사용자 제스처로 선택하고 재승인 가능한 handle을 보관합니다.
- [idb](https://github.com/jakearchibald/idb): IndexedDB transaction 및 handle 보관에 사용합니다.
- [JSM 요청 API](https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-request/): 페이지네이션/권한 범위를 화면 수집 완료로 오인하지 않는 기준으로 참고합니다. 이번 구현은 DOM 수집이며 이 API를 호출하지 않습니다.
