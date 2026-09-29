# 브라우저 코파일럿 검증

표시 버전 **Beta 1.0.0**, 내부 업데이트 **1.4.11**, 패키지 **1.0.0-beta.8**.

## 반영한 흐름

누비는 요구사항을 파악하고 현재 화면을 관찰한 뒤 행동과 검증을 이어간다. 기준 모델은 **Qwen 3.8 27B**다. 신규 AI Pro 연결과 실모델 평가의 기본값은 `QWEN3.8-27B-FP8-256K`이며 저장된 다른 모델 선택은 유지한다.

- 토글은 native checked, ARIA checked/pressed/expanded와 실제 연결된 label을 읽는다. 원하는 상태를 지정하고 이미 맞으면 클릭하지 않는다. 변경 후 상태를 다시 검증한다.
- 클릭 대상을 찾지 못하면 허용된 브라우저 캡처에 실제 이미지, ref와 화면 좌표를 붙여 다음 모델 판단으로 전달한다. 잘못된 동작을 자동으로 재실행하지 않는다.
- 일시적인 모델 연결 오류는 `p-retry`로 최대 3회 복구한다. 무응답 요청을 취소하고 다시 추론하며, 정상 진행 중인 작업은 전체 경과 시간만으로 중단하지 않는다. 성공한 브라우저 쓰기는 반복하지 않는다.
- 요구사항이 모호하면 기존 객관식/주관식 폼을 띄우고 답변 뒤 원래 목표를 이어간다. 최종 등록, 발송, 결제와 삭제는 HITL을 거친다.
- 링크, 카드와 아이콘의 실제 DOM 참조를 사용한다. 새 창 전환을 유지하며 질문, 승인, 채팅과 모달의 글꼴은 공통 CX 토큰으로 맞췄다.

설계와 출처: [토글과 자동 복구](BROWSER-CONTROL-RECOVERY.md), [링크 실행](BROWSER-LINK-RELIABILITY.md), [시각 기준](VISUAL-STANDARD.md).

## 검증 결과

- 단위 **310개**, 디자인 검사와 빌드 통과.
- 실제 Chrome **23개 스위트, 41회** 통과. 핵심 9개를 각각 새 프로필로 3회 반복했다.
- 실제 창을 띄운 토글 복구, 링크 실행, 질문 후 재개 **3회** 추가 통과.
- 320/360/1100px에서 채팅, 질문/승인 폼과 펼친 모달의 계산 스타일을 확인했다.
- ZIP의 **418개 파일**이 검사한 dist의 전체 파일과 바이트 단위로 일치한다. 검사 뒤 재빌드하지 않았다.

[전체 결과](evidence/beta-1.0.0-controls/report.json), [실제 창 검사](evidence/beta-1.0.0-controls/headed/report.json), [토글과 이미지 복구](evidence/beta-1.0.0-controls/toggle-recovery-browser.json), [기본 모델과 선택 유지](evidence/beta-1.0.0-controls/models-browser.json), [설치 파일 검증](evidence/beta-1.0.0-controls/artifact.json).

복구 시나리오는 잘못된 locator 실패 → 새 캡처 → 모델 HTTP 503 → 자동 재호출 → 올바른 switch ref로 변경 → 상태 검증까지 실행한다. 후속 사용자 메시지 없이 완료하며 실제 토글 클릭은 한 번이다. disabled/mixed/변화 없는 토글, 누락된 필수 정보, 새 창의 초안과 HITL, FabriX 형식 복구, ChatGPT 요청, 스트리밍 사용량, 컨텍스트 압축, 사이드 패널, CSP와 로그인/모델 선택 회귀도 포함한다.

이전 후보의 실패도 남겼다. FabriX 502 요청을 1회로 가정하던 fixture는 3회 연결 복구 계약으로 변경했다. 이미지 미지원 fixture는 GLM을 명시했고, 컨텍스트 fixture는 현재 시스템 프롬프트를 포함한 실제 입력 예산으로 요약 조건을 계산한다. 최종 후보에서 전체 선택 범위를 다시 검사했다. [502 fixture 기록](evidence/beta-1.0.0-controls/prior-transport-fixture/report.json), [기본값 fixture 기록](evidence/beta-1.0.0-controls/prior-qwen-fixtures/report.json).

## 검증 범위

사이트와 모델 응답은 합성이고 브라우저 동작은 실제 Chrome이다. Qwen 이름을 사용한 합성 요청은 실제 Qwen의 판단 정확도를 증명하지 않는다. 실모델 평가의 토큰이 설정되지 않아 [실제 AI Pro 평가](evidence/beta-1.0.0-controls/agent-live-evaluation.json)는 `not_configured`로 기록했다. 사내 사이트, 실계정과 전체 기능 행렬의 성공률을 주장하지 않는다.

브라우저가 확장 실행 자체를 종료한 경우의 무인 실행, 단서가 없는 모든 사용자 정의 위젯과 캔버스의 성공을 보장하지 않는다. 승인 대기와 사용자 중지는 유지하며, 연결이 계속 실패하면 보관된 작업과 오류를 남긴다.

## 설치 파일

[nubi-beta-1.0.0.zip](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.8/nubi-beta-1.0.0.zip)

기존 설치 폴더에 덮어쓰고 확장 관리에서 새로고침한다. 기존 폴더 경로를 유지하면 확장 ID와 저장소를 유지할 수 있다.

- ZIP SHA-256: `ae6d8f87df9aaf064ebaa76a9f28d195d77ca5cbea01be98c761b021e995107c`
- dist SHA-256: `7ae148782ee089957e79ea6c965b238a0ce06ae27d9ea31437a4516d36f58ed8`
- ZIP 크기: 8,105,323 bytes
