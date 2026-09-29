# 공개 사이트 50개 과제 평가

`evaluation/public-sites-50.mjs`는 다섯 주제에 서로 다른 열 가지 조사 패턴을 적용한 **50개 읽기 전용 과제**다. 각 과제는 목표와 독립적으로 확인할 결과 근거를 갖는다. 정답 경로를 고정하지 않는다. 광고와 일반 결과 구분, 실제 페이지 이동, 게시자 대조, 설명·자막의 미제공 처리, 교차 출처 검증, 3개 출처 합성까지 포함한다. Google 검색 15개, YouTube 검색 35개를 시작점으로 삼는다.

| 패턴 | 5개 주제에 적용할 목표 | 판정 근거 |
| --- | --- | --- |
| 01 official-pair | 공식 웹 문서와 공식 영상 대조 | 별도 공식 URL, 제목, 게시자 |
| 02 sponsor-separation | 광고와 일반 영상 구분 | 광고 표시, 채널, 영상 URL |
| 03 duration-recency | 두 영상의 길이와 게시 순서 비교 | 각 재생 URL과 실제 표시값 |
| 04 filter-recheck | 동영상·최근 업로드 필터 전후 비교 | 전후 화면과 선택 필터 |
| 05 result-to-watch | 검색 결과에서 공식 재생 페이지로 이동 | 제목·채널 readback |
| 06 description-source | 펼친 설명에서 근거 링크 확인 | 링크 목적지 또는 부재 |
| 07 chapters-captions | 챕터·자막에서 핵심 구간 찾기 | 시간표시와 원문 또는 이용 불가 |
| 08 channel-followup | 동일 채널의 후속 영상 찾기 | 채널과 두 영상 URL, 표시 순서 |
| 09 crosscheck-claim | 영상 설명의 주장 교차 확인 | 영상 원문과 공식 웹 문장 |
| 10 three-source-brief | 공식 문서와 영상 둘을 3문장으로 합성 | 세 출처와 미열람 범위 |

주제는 OpenAI Codex app, NASA Artemis program, MIT OpenCourseWare algorithms lecture, Khan Academy linear algebra, BBC Earth ocean documentary다. 전체 50개 ID와 한국어 과제 문장은 카탈로그에서 확인할 수 있다. 답변만 맞아 보이는 경우는 성공으로 세지 않는다. 다른 출처를 지어내거나, 광고를 공식 결과로 혼동하거나, 자막·설명을 보지 않았는데 본 것처럼 말하면 실패다. 변하는 조회수·게시 시각의 고정 정답은 두지 않고 현재 페이지와 URL을 독립적으로 재확인한다.

평가에는 [Anthropic의 task/trial/grader/trace/outcome 구분](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), [OpenAI의 trace에서 데이터셋 평가로 확장하는 방식](https://developers.openai.com/api/docs/guides/agent-evals), [Codex의 실제 UI·로그를 읽을 수 있는 하네스](https://openai.com/index/harness-engineering/), [OpenCode의 역할별 도구 권한](https://opencode.ai/docs/agents)을 참고했다. 이들은 방법론 참고이며 누비의 실측 결과가 아니다. 이미 번들한 Playwright와 누비의 읽기 도구를 사용한다. BrowserGym은 공개 벤치마크 연결 후보지만 이 과제의 실제 Google·YouTube 페이지를 대체하지 않아 이번 패키지에 추가하지 않았다.

`node scripts/probe-public-sites.mjs`는 별도 Chrome 프로필에서 고유 시작 URL 10개를 열고 누비의 실제 `read_page`로 관찰한다. 같은 URL을 쓰는 과제에는 접근 가능 여부만 공유한다. 이 단계는 **과제 완수 평가가 아니다**. 사이트가 자동화 접근을 차단하면 `blocked`로 기록하고 우회하지 않는다. 실모델 50개 과제의 완료 점수는 누비가 실제 제공자에 연결되어 각 과제를 수행하고, 최종 URL·원문·상태를 독립 채점할 때만 계산한다. 모델 연결이 없으면 `unscored_no_model`로 둔다. 각 과제는 최소 3회 시도와 개별 trace를 권장하며, 불완전한 시도 집합은 종합 점수에서 제외한다.

2026-09-25 [실제 사이트 관찰 보고서](../verification/public-sites-2026-09-25T14-44-44-020Z/report.json): 누비 `read_page`로 YouTube의 5개 검색 시작 화면을 읽어 35개 과제의 초기 접근 가능성을 확인했다. [누비가 캡처한 YouTube 화면](../verification/public-sites-2026-09-25T14-44-44-020Z/youtube-nubi-capture.png)도 저장했다. Google 첫 검색은 비정상 트래픽 확인 화면이어서 해당 시작점의 3개 과제는 `blocked_challenge`, 나머지 Google 시작점의 12개 과제는 `skipped_after_origin_block`이다. 50개 모두 모델 과제 완수는 `unscored_no_model`이다. 확인 화면을 우회하거나 검색 결과를 추정하지 않았다.
