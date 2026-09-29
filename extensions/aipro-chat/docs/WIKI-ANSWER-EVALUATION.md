# 한국어 Wiki 검색과 답변 평가

NQ-03의 개발용 정답 세트와 채점기. 회사 원문/계정을 사용하지 않는다. 질문 16개 중 정답 근거가 있는 10개, 제외 문서의 검색 유출 검사 5개, 자료에 답이 없는 질문 1개다. 내장 Wiki는 실제 `siteWikiSnapshot`의 origin/provider/검토일/삭제 필터를 통과시키고 외부 폴더는 별도 snapshot으로 평가한다. 약 75,000자 문서의 중간과 끝, 멀리 떨어진 표 머리글, Markdown/한국어 띄어쓰기/Unicode, 일반 규정과 예외를 포함한다.

## 명령과 평가 경계

- `npm run eval:wiki`: 실제 MiniSearch/Markdown 검색을 사용한다. 문서 Recall@8, 정답 원문 범위 회수율@8, MRR을 별도로 기록한다. 답 없는 질문의 검색은 관련 배경을 찾을 수 있으므로 성공으로 가산하지 않는다. 제외된 문서는 결과 0건을 요구한다.
- `npm run eval:wiki -- --answers capture.json`: `datasetSha256`와 사례 ID가 일치하는 OpenWiki 결과를 채점한다. 모든 사례가 정확히 한 번 있어야 하며 누락/중복/다른 자료 버전은 통과시키지 않는다. 파일만으로 실제 누비/모델 실행을 증명하지 않는다.
- `npm run eval:wiki:live`: 전용 `NUBI_EVAL_TOKEN`, 선택적 `NUBI_EVAL_MODEL`과 `NUBI_EVAL_REPEATS`를 사용한다. `.env`나 다른 앱 인증을 가져오지 않는다. 기본 Qwen/3회, 같은 모델에서 검색 발췌 8개 기반 단일 답변과 실제 OpenWiki 위임을 비교한다. 조건 순서를 교대하고 매번 새 문맥을 만든다. 정답은 모델 입력에 넣지 않는다. 시간/호출/입력 문자 수를 기록하며 문자 수를 토큰/비용으로 부르지 않는다.

Live 실행은 **Node에서 제품의 읽기 전용 OpenWiki 코어와 응답 파서를 사용한 평가**다. 브라우저 전체 업무, SSO나 UI 성공률이 아니다. 유효한 API 응답이 파싱된 경우만 응답 수에 포함한다. 401/403은 실패 사례를 남긴 뒤 즉시 중단한다. 평가 자원 한도 180초/80호출은 제품 실행 제한이 아니다. 현재 인증 없음으로 `not_configured`이며 실제 비교 수치는 없다.

답변 채점기는 Wiki 식별자, 문서 해시/버전/경로/종류, UTF-16 원문 범위와 발췌, 실제 인용 ID, 정답 근거 누락 및 명시적 답변 보류를 검사한다. 답변의 제한된 사실 문자열 일치는 보조 지표다. **인용이 유효하다는 사실만으로 문장이 원문에서 도출되거나 추가 환각이 없다고 판정하지 않는다.** `semanticFaithfulness`와 `modelCapabilityScore`는 미측정이다. 자유로운 바꿔쓰기와 모순 판단에는 독립적으로 보정한 의미 평가/사람 검토가 필요하다.

## BP와 오픈소스

| 후보 | 적용 판단 |
| --- | --- |
| [Haystack DocumentRecallEvaluator](https://github.com/deepset-ai/haystack/blob/main/haystack/components/evaluators/document_recall.py), Apache-2.0 | 실제 소스의 중복 문서 제거와 multi-hit 정답 문서 회수율을 참고했다. 누비는 문서 전체 발견과 필요한 원문 구간 발견을 분리한다. Python 실행 환경을 확장에 추가하지 않는다. 소스 복사/패키지 도입은 없다. |
| [Ragas metrics](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/), Apache-2.0 | 검색 회수율과 답변 사실성의 평가 분리를 참고한다. Ragas를 설치하거나 자의적인 문자열 검사를 Ragas faithfulness로 표시하지 않는다. LLM judge는 별도 인증/비용/보정이 필요해 이번 정답 범위 검사에는 도입하지 않는다. |
| 기존 MiniSearch/MDAST/DeepAgents | 제품 구현을 직접 재사용한다. 검색용 질문 세트에서 재현된 엔진 결함 없이 다른 엔진으로 교체하지 않는다. |
| 기존 Playwright | MV3 worker에 동일한 검색 소스를 번들하고 정답을 전달하지 않은 채 16개 질문을 실행한다. 실제 계정/모델 결과로 확대 해석하지 않는다. |

## 검사

`wiki-quality.test.mjs`는 정답 범위, 긍정/부정 채점, 잘못된 Wiki/해시/버전/인용, 표 단위/예외/뒤쪽 근거 누락, 누락/중복 기록, 조건 순서/동일 모델, 인증 중단을 검사한다. `wiki-quality-browser.mjs`는 실제 MV3 검색 결과를 별도 정답으로 채점한다. 첫 fixture는 목표 길이보다 짧아 실패해 길이를 늘렸고, 초기 브라우저 probe는 worker export 조건 누락으로 로드에 실패해 기존 `wikiBrowserBuild`를 재사용했다. 제품 검색 결함으로 분류하지 않는다.

기록: `verification/wiki-evaluation-2026-09-24T14-07-44-198Z/report.json`, `verification/wiki-quality-browser.json`, `verification/wiki-live-2026-09-24T14-07-32-195Z/report.json`. 최종 후보의 공통 검증은 [품질 목록](BROWSER-QUALITY-BACKLOG.md)에 모은다.
