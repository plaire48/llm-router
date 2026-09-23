# VOC 자료 보관과 근거 조회

2026-09-23. JSM 자동 수집 전 단계로, 정제한 티켓 JSON을 실제 Workspace에 보관하고 Pi에서 검색/구간 조회하는 흐름을 구현했다. 실제 JSM 로그인이나 첨부파일 다운로드는 수행하지 않는다.

## 사용

`소스와 Wiki → VOC 자료 → 가져오기`에서 `nubi-voc-v1` JSON을 선택한다. [예시](../examples/voc-example.json)를 기준으로 한다. Jira 원본 API JSON을 그대로 받는 범용 가져오기 기능은 아니다. 파일은 1MB까지이며 현재 열린 Git Workspace의 `voc/records`에 저장한다. 다른 폴더는 해당 Workspace로 열어야 한다.

원본 JSON, 정규화 JSON, 읽기용 Markdown과 manifest를 저장한다. 댓글과 문서 발췌의 ID/공개 범위/출처를 유지한다. 모델이 작성한 원인이나 해결 요약을 자동으로 사실로 확정하지 않는다. 현재 문서 텍스트는 입력 자료에 포함된 발췌이며 Docling/OCR을 실행한 결과가 아니다.

자료는 사이트 origin과 티켓 key별로 나누고 내용 해시를 revision ID로 사용한다. 동일 자료는 중복 생성하지 않는다. 최신 원격 updated 시각을 기준으로 검색하며 과거 revision은 ID로 계속 읽을 수 있다. 같은 수정 시각에 서로 다른 내용이 제공되면 `conflictingRevision`을 반환한다. 동일 origin의 여러 Jira context 설치 구분은 아직 지원하지 않는다.

임시 폴더에 파일을 쓴 뒤 최종 revision 폴더로 옮기고 readback 해시를 확인한다. 의도를 SQLite에 먼저 기록한다. 응답 유실 시 실제 파일의 해시로 완료 여부를 복구하고, 확정 폴더가 없는 미완료 import만 같은 입력으로 재시도한다. 기존 확정 자료가 사라지거나 바뀌면 덮어쓰지 않는다. 사람의 메모는 생성물 밖에 둘 수 있다. 로컬 파일 시스템의 동시 악성 경로 교체를 차단하는 격리 환경은 아니다.

## OpenCode / Anthropic / Codex에서 적용한 원칙

| 출처 | 적용 |
| --- | --- |
| [OpenCode tools](https://opencode.ai/docs/tools/) | 검색 도구와 구간 읽기 도구를 나눈다. `search_voc`는 최대 8개 후보와 짧은 발췌, `read_voc`는 최대 80줄/16K 문자를 반환한다. 긴 한 줄도 `nextStart`와 `nextOffset`으로 누락 없이 이어 읽으며 UTF-16 문자 쌍을 나누지 않는다. 새 OpenCode 런타임이나 계정 연결은 추가하지 않았다. |
| [Anthropic long-running harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 진행 상태와 결과 영수증을 모델 문맥 밖에 저장하고 재개 시 확인한다. 파일 저장과 내용의 사실 검증을 구분한다. |
| [OpenAI harness engineering](https://openai.com/index/harness-engineering/) | 정리된 원본/근거를 에이전트가 탐색하게 하고, 검증 가능한 해시와 명시적 미확인 상태를 유지한다. |

실제 재사용 OSS는 기존 **AJV**의 엄격한 계약 검사, **MiniSearch 7.2.0**의 검색, **SQLite**의 상태 저장, 기존 **Pi** 도구 실행과 동결 근거 분석이다. 새 프레임워크를 추가하지 않았다. 한국어 검색은 `Intl.Segmenter`의 단어 분리를 사용한다. 의미 검색이나 한국어 형태소 분석 정확도를 검증한 것은 아니다.

조회마다 저장된 payload 해시를 검증한다. 검색은 최신 티켓 최대 100건과 약 8MB 텍스트 예산으로 제한하고 누락을 명시한다. 손상된 최신 자료 대신 오래된 결과를 최신인 것처럼 반환하지 않는다. `read_voc`의 동결 근거는 기존 하위 분석에서 읽을 수 있지만 native 도구나 소스 편집 관찰 권한을 주지 않는다. 원문은 신뢰되지 않은 참고 자료이며 사용자 지시를 바꿀 수 없다.

## 아직 필요한 작업

- 로그인된 브라우저/JSM API에서 실제 티켓을 읽어 이 계약으로 변환하는 수집기.
- A2A 파일 전송과 첨부파일 해시/크기/다운로드 상태 검사.
- Docling/MarkItDown 비교 평가 및 로컬 변환 worker. 현재 둘 다 설치하지 않았다.
- 기간/페이지별 수집 체크포인트와 변경분 갱신. 현재 복구는 한 건 import 범위다.
- VOC 전용 OpenWiki resolver와 의미 검색, 대용량 색인, 같은 시각의 충돌 revision 비교 UI.
- Windows 및 사내 JSM 실계정, 실제 Qwen 분류/근거 정확도 평가.

현재 `sourceTrust:user_imported`, `verification:stored_bytes_only`는 저장한 바이트를 확인했다는 뜻이다. JSM에서 실제로 조회했거나 티켓이 해결됐다는 뜻이 아니다.

## 검증 기록

패키지 회귀 120개가 통과했고, 마지막 본문 표시/댓글 시각 수정 후 VOC 계약 7개를 다시 통과했다. 실제 Chrome의 컴파일된 Theia UI 47개와 공유 UI 14개 검사가 통과했다. VOC JSON의 실제 파일 저장, 중복 없음, 검색/원문 열기, 좁은 화면과 편집 탭 위의 상단 알림을 확인했다. Pi 호출 테스트는 합성 모델 응답이며 실제 Qwen/JSM 정확도를 증명하지 않는다.

브라우저/Electron 빌드와 macOS Electron 실제 구동, worker IPC 및 OpenWiki 조회도 통과했다. Windows 설치 실행과 사내 계정 검증은 별도다. 상세 결과는 `verification/voc-import-result.json`에 남겼다.

2026-09-23 추가 점검: 긴 한국어/이모지 문단의 분할 조회와 정확한 원문 재구성 회귀를 추가했다. Windows 계약 검사와 실제 설치 앱의 worker IPC 검사에도 VOC import, 중복 방지, 검색, 긴 본문 읽기를 포함한다. 실행 결과와 플랫폼별 통과 여부는 배포 검증 보고서를 따른다. A2A 추가 구현은 보류하며 현재 단계에서 파일 전송을 추가하지 않는다.
