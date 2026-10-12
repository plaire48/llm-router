# GenOffice·누비 재사용 검토

확인일: 2026-10-13. 사용자 결정에 따라 GenOffice를 Agent 실행부의 실제 기반으로 사용한다.

| 대상 | 결정 | 실제 반영 |
| --- | --- | --- |
| GenOffice agent-core | 원본 그대로 도입 | AgentLoop, composeSkills, 도구 인자 검사, 취소, 실행 한도, 문맥 압축 |
| GenOffice ai-provider | 원본 그대로 도입 | streamForProvider, 사용자 지정 endpoint, SSE 및 tool call 파싱, timeout 처리 |
| GenOffice 문서 skill 인터페이스 | 직접 사용 | Excel VSTO 도구를 AgentSkill로 구현 |
| GenOffice Electron UI·문서 엔진 | 이번 배포에서 제외 | Windows Office가 열린 문서·저장을 소유. 파일 파서 경로를 연결하지 않음 |
| 기존 누비 VSTO 생성 진입점 | 복사 | ThisAddIn.Designer.vb, ThisAddIn.Designer.xml |
| 기존 누비 리본·호스트 빌드 | 수정해 재사용 | 최소 VB VSTO entry, C# host 연결, 창별 작업창 |
| 기존 누비 ExcelPort·WorkerProcess | 필요한 패턴을 옮겨 재작성 | COM identity, 닫힘·삭제 무효화, UI 스레드 접근, stdio 자식 프로세스 |
| 누비 공통 인증·계정 모델 목록·채팅 UI | 원본 복사·어댑터 연결 | [0.2.0 상세](nubi-integration.md), 원본 88개 파일·자산 해시 검사 |
| 기존 누비 전체 WorkbookEngine·Pi 실행부 | 도입하지 않음 | 기존 광범위 기능·UI 결합을 피하고 GenOffice를 실행부로 사용 |
| 기존 누비 A2A | 후속 연결 후보 | 작업 수신·실행 ID 결합 코드를 검토. 이번 코드에는 활성화하지 않음 |

GenOffice 고정 커밋은 `438d9c65709952490c970beaa2599ef45e74431f`이다. 85개 파일을 수정 없이 저장했고 `vendor/genoffice-source.json`으로 해시를 검사한다. 해당 디렉터리 밖에 Office X 코드를 둬 업스트림 변경과 어댑터 변경을 분리한다. [고정 소스](https://github.com/genspark-ai/genoffice/tree/438d9c65709952490c970beaa2599ef45e74431f)

기존 누비는 `/Users/ganadi/Documents/llm_router`의 현재 작업 파일을 확인했다. 당시 Git HEAD는 `7dbaf0f6cdb3ea938e09b743b2d8bc31ce8d953e`이며 실제 읽은 파일별 해시는 `vendor/nubi-source.json`에 기록했다. 누비 저장소 자체는 수정하지 않았다.

## A2A 연결 시 확인할 사항

공통 A2A 코드와 Office 수신 코드는 존재한다. 그러나 기존 저장소 지침에는 Desktop A2A를 비활성화한 결정도 남아 있으며, 코드의 존재와 현재 Workspace 제품에서의 활성화는 다른 사실이다. 이 새 프로젝트에서는 사용자의 최신 A2A 방향을 따른다. 실제 통합 단계에서 Workspace 호스트의 기능 노출·인증·작업 상태 계약을 현재 코드와 다시 대조한다.

기존 office-tasks의 완료는 실제 실행 답변의 전달이며 `verification: not_run`으로 처리한다. Office X는 네이티브 수식·값 검증 결과를 따로 가지므로 향후 A2A 연결 시 전달 완료와 문서 검증 성공을 구분하는 증거 필드가 필요하다.

## 라이선스와 범위

GenOffice의 Apache-2.0 LICENSE와 NOTICE를 보존했고 ee/는 가져오지 않았다. 누비의 기존 VSTO 진입점은 office-ai-agent 기반 출처와 Apache-2.0 문서를 함께 남겼다. 기존 누비의 브랜딩이나 다른 파일에 이 라이선스를 확대 적용하지 않는다.

이번 도입은 GenOffice **핵심 Agent 런타임을 베이스로 사용**하는 것이다. GenOffice 전체 앱·편집기·표현 기능을 VSTO로 포팅했다는 의미는 아니다.
