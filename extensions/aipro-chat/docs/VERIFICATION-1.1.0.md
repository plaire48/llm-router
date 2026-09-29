# 누비 1.1.0 OpenWiki 읽기 연결

날짜: 2026-09-22. 전체 회귀 검증과 설치 ZIP 생성을 완료했다. 공개 업로드하지 않았다.

## 구현 범위

- 입력창의 프로젝트 아이콘에서 로컬 OpenWiki에 연결한다. 주소 자동 제안, 재연결/해제, 이름 칩과 오류 복구를 제공한다.
- OpenWiki-SDS 0.6.0의 실제 HTTP 서버를 직접 호출한다. 일회 연결 코드와 프로젝트 토큰은 모델/진단/local 저장소에 넣지 않는다.
- Wiki 검색/읽기와 명시한 project-root의 소스 검색/읽기를 기존 Pi 도구 그룹에 연결했다. 파일/실제 줄 범위/해시를 반환한다.
- 프로젝트 조회는 페이지 연결·디버거 없이 동작한다. 연결된 프로젝트 질문에 광역 페이지 권한을 미리 요청하지 않는다. 브라우저 조작에는 기존 사이트 권한이 별도로 필요하다.
- 읽은 코드와 Wiki는 참고 데이터이며 등록/배포 승인이나 실행 권한이 아니다. 파일 쓰기/빌드/MCP/터미널은 이번 범위가 아니다.

## 확인한 결과

[전체 결과](evidence/1.1.0-report.json): 36개 브라우저 스위트의 56회 실행(핵심 10개는 각각 3회)을 두 실행에 걸쳐 확인했다. 사용량 검사가 1.0.2 이전 빈 상태 문구를 기대해 중단된 뒤, 테스트 문구를 현재 UI에 맞춰 남은 검사를 실행했다. 두 빌드의 내용 해시가 일치하며 한 번의 중단 없는 통과로 표현하지 않는다.


- 확장 단위 테스트 250개, CX 디자인 검사와 1.1.0 후보 빌드 통과.
- OpenWiki 서버/시각화/CLI 관련 213개 테스트, ESLint/빌드와 실제 CLI 서버의 연결→소스 조회 통과. Node 25에서 기존 jsdom 검사와 내장 Web Storage의 충돌은 테스트 실행에 `NODE_OPTIONS=--no-experimental-webstorage`를 적용했다.
- [실제 서버 연결 8개 시나리오](evidence/1.1.0-openwiki.json): 실제 Chrome 확장과 OpenWiki HTTP 처리기, 임시 프로젝트 파일을 사용했다. 페이지 없는 도구 호출, 파일 변경 후 해시, 새로고침 복원, 연결 해제, 구버전/메타 누락/원격 주소 거절, Wiki-only, 서버 종료를 검사했다.
- [화면과 소스 비교](evidence/1.1.0-openwiki-screen.json): 현재 탭 읽기와 source_search/read_source, 두 근거의 결과 검토와 파일:행 인용 표시. 이 읽기 흐름의 debugger 호출은 0회다.
- [연결 UI](evidence/1.1.0-openwiki-ui.json): 320/360/1100px에서 제목/본문 글꼴, 초점 복귀, 주소 숨김, 오류/재시도, 연결/만료/재연결/해제와 실행 중 변경 차단을 검사했다.

화면: [연결](images/1.1.0/project-connect.png), [사이드 패널](images/1.1.0/project-panel.png), [화면과 소스 인용](images/1.1.0/source-answer.png).

## 검증 경계

OpenWiki 서버와 파일·브라우저 동작은 실제 실행이다. 모델 응답은 합성이므로 실제 모델의 파일 선택·추론 성공률이나 화면과 컴포넌트의 자동 매핑 정확도를 증명하지 않는다. 회사망 AI Pro/FabriX, ChatGPT 실계정, Windows/Edge는 확인하지 않았다. 사이트 권한 거절은 검사했으며 연결 테스트에서 해당 loopback origin만 사전 허용했으므로 네이티브 허용창 클릭 성공으로 표현하지 않는다.

초기 확장 단위 검사에서는 data-URL로 worker를 불러오는 기존 테스트가 새 모듈 경로를 해석하지 못했다. 테스트의 명시적 import 목록에 두 모듈을 추가한 뒤 다시 검사했다. 제품의 권한·소유권 조건은 완화하지 않았다.

## 설치

확장은 개발자 모드용 ZIP이다. OpenWiki 연결은 OpenWiki-SDS 0.6.0 서버를 실행해야 한다. 기존 일반 채팅/브라우저 기능은 서버 없이 사용할 수 있다.

```sh
npm install -g ./openwiki-SDS-0.6.0.tgz
openwiki visualize /path/to/project/openwiki --project-root /path/to/project
```

OpenWiki 설치 파일: `releases/openwiki/openwiki-SDS-0.6.0.tgz` (저장소 루트 기준).

OpenWiki SHA-256: `b2370cd64af667ddb83d436ff6b32850fd4e66b246e956ac20e419a899c3bf69`.

확장 ZIP: `releases/aipro-chat-extension-1.1.0.zip`. 검사한 후보를 재빌드하지 않고 복사했으며 195개 파일이 dist와 바이트 단위로 일치한다.

확장 SHA-256: `f15c54b78bcd0afd16bc61862c2434c22563a49f94ba6926f0a62b1c3fc05e97`.
