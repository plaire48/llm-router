import {naverTasks} from './naver-50.mjs';

// Keep the beta35/v1 catalog intact so the first real-model trials remain
// reproducible. V2 removes missing selectors and impossible-to-assume facts
// without making the multi-source research work easier.
const revised = new Map([
  ['naver-01-01', '검색에서 가장 최근 확인되는 대한민국 펜싱 경기 한 건을 먼저 식별해 경기 결과와 관련 메달 집계를 스포츠 카드·뉴스 원문·영상 설명에서 교차 확인하고, 세 화면의 갱신 시각 차이를 설명해 줘. 해당 경기가 없으면 실제 확인한 검색 범위와 미확인 출처를 밝혀 줘.'],
  ['naver-01-02', '검색 결과에서 이름과 개인전·단체전 구분이 명시된 대한민국 펜싱 선수 한 명을 먼저 선택해, 그 선수의 경기 순서와 결과를 대진표·기사에서 재구성해 줘. 구분 근거가 없으면 섞지 말고 확인 가능한 범위만 답해 줘.'],
  ['naver-01-03', '검색 첫 화면에서 오래된 기사와 최신 결과를 구분하고, 더보기 또는 다음 결과까지 읽어 서로 충돌하는 수치가 있는지 확인해 줘. 충돌이 없으면 읽은 결과 범위와 시각을 밝히고 없었다고 답해 줘.'],
]);

export const naverTasksV2 = naverTasks.map(task => ({...task, goal: revised.get(task.id) || task.goal, catalogVersion: 2}));
