# 긴 문서의 병렬 읽기와 복구

## 적용

첨부 문서 전체를 한 담당의 입력에 넣지 않는다. `read_document(mode=plan)`이 원문을 LangChain RecursiveCharacterTextSplitter로 나누고, 해시와 문자 범위만 반환한다. 한 번에 최대 6개 범위를 반환하며 `next_offset`부터 다음 묶음을 만든다. 본문과 원본 파일은 대화 소유 IndexedDB에 남는다.

메인 에이전트는 독립적인 구간을 `delegate_analysis.document_ranges`로 배정한다. p-limit으로 담당 2개가 동시에 실행되고 최대 6개가 대기한다. 각 담당 안에서는 Pi의 읽기 도구 병렬 실행으로 독립된 조회 2개를 함께 처리할 수 있다. 따라서 분석 담당 전체의 실제 읽기는 최대 4개다. 검색 결과를 보고 범위를 결정해야 하는 조회는 순차 실행한다. 브라우저 쓰기는 이 경로에 없다.

각 담당은 지정된 문서/해시/범위만 읽는다. 범위를 벗어난 읽기와 검색은 거절하고, 성공한 원문의 범위만 `document_progress.read`에 기록한다. 중복/겹친 범위는 합쳐 계산한다. `remaining`이 있으면 모델이 complete라고 답해도 partial로 바꾼다. 메인은 요약과 출처를 합치고 구간을 넘나드는 정의, 표, 참조, 모순을 별도 검토한다. 병렬 분할 자체가 의미 이해의 정확도를 보증하지 않는다.

## 한도와 오류

| 상황 | 처리 |
| --- | --- |
| 담당의 입력/호출 예산에 접근 | 마지막 호출을 도구 없는 부분 요약에 예약한다. |
| 제공자가 context_overflow 반환 | 더 작은 근거 묶음으로 부분 요약을 한 번만 시도한다. |
| 요약도 실패 | 성공한 읽기 출처와 읽지 않은 범위를 반환한다. 읽은 범위도 review_needed로 남긴다. |
| 독립 조회 중 하나 실패 | 성공한 조회는 보존한다. 오류를 모델에 전달해 범위/검색어를 바꾸거나 부분 결과를 반환한다. |
| 응답 형식/출력 잘림 | 기존 보고 형식 교정과 부분 요약 경로를 사용한다. 도구를 다시 실행하지 않는다. |
| 일시적 모델 통신 장애 | 기존 제공자 p-retry와 공유 대기를 사용한다. 별도의 중첩 재시도 루프를 추가하지 않는다. |
| 사용자 취소/인증 실패 | 재개하지 않는다. 대기 중인 담당도 정리한다. |

재배정은 메인 모델이 반환된 `remaining`을 다음 작업으로 제출한다. 새 담당은 깨끗한 문맥에서 시작한다. 성공한 다른 담당까지 다시 실행하지 않는다. 모든 구간을 읽었지만 요약이 실패했다면 기존 근거나 원문으로 해석을 다시 확인한다. 읽기 완료와 분석 완료는 다르다.

실행 중 부모 문맥이 압축돼도 최근 문서 작업의 ID/해시/범위/남은 부분은 요약 모델과 별도로 보존한다. 보관 한도를 넘으면 생략 개수를 명시한다. 원문은 유지되지만 Chrome/worker 종료 이후 하위 작업 스케줄러 자체를 자동 복원하는 기능은 아니다.

## 선택한 근거와 오픈소스

- [OpenAI의 긴 문서 요약 예제](https://developers.openai.com/cookbook/examples/summarizing_long_documents): 부분 요약 후 통합하는 원리. 보관된 예제이므로 과거 모델/API 설정은 도입하지 않았다.
- [Anthropic의 컨텍스트 엔지니어링](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): 하위 담당의 문맥 격리, 압축, 구조화 기록을 조합한다.
- [OpenCode V2 compaction](https://dev.opencode.ai/v2/docs/compaction/): 출력 여유를 남기고 완료된 요약만 사용하며 overflow 복구를 제한하는 원리를 참고했다. OpenCode 런타임이나 Node 서버를 확장에 추가하지 않았다.
- Pi 0.86.1의 native parallel execution, p-limit 7.3.3, 기존 LangChain textsplitters 1.0.1을 사용한다. 이 기능을 위해 새 에이전트 프레임워크를 중복 도입하지 않았다.

## 검증 범위와 제한

`tests/document-partition.test.mjs`는 반복 문단/공백을 포함한 원문 복원, 독립 담당의 실제 Pi 병렬 읽기, 구간 경계/해시 검증, 누락 범위 재배정, 일부 조회 실패, context overflow와 요약 실패를 검사한다. `tests/context-evidence.test.mjs`는 명시적/자동 보고의 작업 범위 보존을 검사한다. `tests/document-retrieval-browser.mjs`는 Chrome 확장과 IndexedDB 원문, 합성 Qwen 응답을 사용해 분할 계획부터 병렬 조회와 완료 기록까지 확인한다.

현재 첨부 추출 한도는 파일당 40,000자다. 이 변경은 업로드 한도를 늘리지 않는다. PDF/DOCX는 기존 추출 텍스트만 대상이며 OCR/표 레이아웃을 보증하지 않는다. 담당의 문자 예산은 정확한 모델 토큰 계산이 아니며, 실제 overflow는 위 복구 경로로 처리한다. 실계정 Qwen의 품질/속도/총 토큰 절감은 별도 평가가 필요하다. 전체 토큰 비용은 병렬 담당 수에 따라 늘 수 있다.
