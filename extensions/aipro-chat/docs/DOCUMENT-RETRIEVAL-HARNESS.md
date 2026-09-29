# 문서 활용과 역할별 컨텍스트

2026-09-23. 확장 단독 사용과 Qwen 3.8 27B 기준을 유지한다. 실제 사내 모델의 성능 순위를 측정했다는 의미는 아니다.

## 확인한 빈틈

기존 Pi 실행/서브에이전트, OpenWiki 검색, PDF.js/Mammoth 읽기와 대화 압축은 이미 있었다. 그러나 첨부 원문은 매 요청 본문에 들어갔고, 조사 담당은 연결된 OpenWiki에만 접근했다. 요약된 첨부의 원문을 모델이 필요할 때 다시 검색하는 도구도 없었다.

## 채택 판단

| 기반 | 실제 적용 | 판단 |
| --- | --- | --- |
| [LangChain text splitters](https://docs.langchain.com/oss/javascript/integrations/splitters) | MIT `@langchain/textsplitters` 1.0.1의 RecursiveCharacterTextSplitter | 문단/줄/단어 경계를 따라 분할한다. 직접 만든 고정 길이 절단 대신 브라우저 번들에서 실제 사용한다. peer core 1.2.12와 전이 의존성은 lockfile/라이선스로 고정한다. |
| [MiniSearch](https://github.com/lucaong/minisearch) | 기존 MIT 7.2.0을 첨부 구간 검색에도 사용 | 한국어 정규화와 제목/본문 순위가 기존 관찰 및 Wiki 검색과 같다. 외부 임베딩 서버나 별도 API 키가 필요 없다. |
| [Pi subagent 공식 예제](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent) | 기존 Pi Agent 0.86.1의 독립 실행을 문서 담당으로 확대 | 예제의 별도 CLI 프로세스는 확장에 복사하지 않는다. 실행 라이브러리는 이미 Pi이며 담당별 최소 입력, 독립 대화, 취소 전파와 사용량 기록을 유지한다. |
| [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) | 문서 원문을 외부 저장하고 필요할 때 찾아 읽는 설계 적용 | 전체 하네스를 추가하면 기존 Pi/제공자/HITL/수명 처리를 다시 연결해야 한다. 이번에는 실제 빈틈에 필요한 LangChain 모듈을 도입한다. Deep Agents 전체를 도입했다고 표현하지 않는다. |
| [Anthropic 연구 에이전트](https://www.anthropic.com/engineering/multi-agent-research-system)와 [컨텍스트 관리](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 독립 조사 배정, 요약/근거 반환, 필요한 시점의 원문 로딩 | 비교할 문서와 질문을 분리하고 부모는 실제 근거로 최종 검토한다. 모든 작업을 병렬화하거나 토큰 절감을 보장하지 않는다. |
| [Pi 압축](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md) | 기존 요약/최근 대화 보존에 문서 재조회 연결 | Node coding-agent를 새로 실행하지 않는다. 브라우저 전용 어댑터가 원본, 사용자 제약과 도구 쌍을 지킨다. |

Readability는 기사 본문 추출에 유용하지만 이번 첨부 검색의 대체품은 아니다. 현재 페이지의 폼/표/조작 맥락을 기사 추출기로 일괄 대체하지 않는다.

## 사용자 흐름

문서를 첨부하거나 연결된 OpenWiki를 지정하고 평소처럼 요청한다. 추가 모달이나 검색 버튼은 없다. 누비가 문서 ID/이름을 보고 검색하고 필요한 구간을 읽는다. 독립적인 비교라면 역할별 담당에 해당 문서만 배정한다. 결과는 요약, 출처와 원문 위치를 통해 합쳐진다. 브라우저 작성 요청이면 기존 입력/관찰/검증과 최종 승인 흐름을 이어간다.

- 6,000자 초과 첨부 텍스트는 원문을 자동 주입하지 않는다. 짧은 첨부와 이미지의 기존 제공자 호환 흐름은 유지한다.
- search_documents의 빈 query는 목록이고 실제 원문 읽기가 아니다. 긴 목록은 페이지로 읽는다. 검색 결과도 전체 문서의 완독이 아니다.
- 원문은 filename, SHA-256, 원문 문자 범위와 추출 텍스트의 줄 번호를 제공한다. PDF의 줄은 추출 텍스트 기준이며 인쇄 페이지 번호가 아니다.
- 요약된 과거 메시지에 있던 첨부도 같은 대화에서 다시 조회한다. 다른 대화/제공자의 문서는 조회하지 않는다.
- 담당은 배정된 document_ids만 검색/읽기한다. 소스 원문에 지시가 있어도 사용자 요구나 권한으로 취급하지 않는다.
- 부분 근거와 실제 브라우저 결과를 구분한다. 문서 근거로 화면 적용/등록 성공을 주장할 수 없다.

## 범위와 한계

첨부 텍스트/PDF/DOCX, 연결된 OpenWiki와 기존 브라우저 페이지 읽기가 대상이다. PC 전체 파일 검색, OCR, Office 레이아웃/도형 분석, 외부 벡터 DB와 범용 웹 검색 API는 새로 추가하지 않았다. 현재 PDF/DOCX 추출 텍스트 40,000자 등 기존 업로드 한도를 유지한다. 원문이 더 크면 조용히 자르지 않고 기존 제한을 알린다. 어휘 검색은 표현 차이로 놓칠 수 있으므로 다른 키워드나 원문 조회로 보완한다.

## 검증

`tests/document-tools.test.mjs`: 한국어 문서 뒤쪽의 사실, 정확한 원문 범위와 해시, 전체 구간 재조립, 잘못된 ID/범위, 변경된 파일, 목록 페이지, 문서 담당의 범위 격리를 검사한다.

`tests/document-retrieval-browser.mjs`: 실제 Chrome에서 파일 업로드, Qwen 계약의 Pi 연구 담당 두 개, PDF.js/Mammoth 파싱, 원문 근거의 최종 검토, 요약 경계와 새로고침 이후 재조회, 새 대화 격리를 검사한다. 모델 응답은 합성이며 실제 Qwen 판단 성능은 별도 검증한다.

최종 후보와 실제 통과 기록은 `verification/document-retrieval`을 따른다.
