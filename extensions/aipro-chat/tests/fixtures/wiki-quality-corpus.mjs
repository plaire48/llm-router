import {siteWikiSnapshot, KNOWLEDGE_TTL} from '../../browser-knowledge.js';

// Authored synthetic policies, not company data. Gold facts never enter the
// retriever/model input. Offsets refer to original UTF-16, before normalization.
export const WIKI_DATASET_VERSION = 'ko-wiki-v1';
export const FIXED_NOW = Date.UTC(2026, 8, 24);
const origin = 'https://wiki-quality.example.test';
const scope = {origin, provider: 'aipro'};
const entry = (id, title, markdown, extra = {}) => ({url: `${origin}/${id}`, title, markdown, provider: 'aipro', verifiedAt: FIXED_NOW, documentVersion: 2, ...extra});
const internalEntries = [
  entry('travel', '국내 출장 규정', '# 국내 출장\n숙박비 한도는 1박에 55,000원입니다.\n출장 신청은 출발 3일 전에 제출합니다.'),
  entry('exception', '국내 출장 예외', '# 국내 출장 예외\n제주 숙박비 한도는 1박에 90,000원입니다.\n부서장 사전 승인이 필요합니다.'),
  entry('leave', '휴가 신청', '# 휴가 신청\n휴가 **신청**은 팀장에게 제출합니다.\n연차 잔여 일수는 인사 담당자가 확인합니다.'),
  entry('receipt', '접수 확인', '# 접수 확인\n저장 버튼을 눌렀다는 사실만으로 접수 완료가 아닙니다.\n접수 번호가 표시되면 완료입니다.'),
  entry('currency', '출장 식비', '# 출장 식비\n금액 단위는 원입니다.\n\n| 항목 | 일일 한도(원) |\n| --- | --- |\n| 식비 | 25,000 |'),
  entry('old', '폐기된 규정', '# 구규정\n구규정암호는 OLD입니다.', {verifiedAt: FIXED_NOW - KNOWLEDGE_TTL - 1}),
  entry('removed', '폐기 문서', '# 폐기 문서\n폐기암호는 GONE입니다.', {invalidated: true}),
  entry('review', '재검토 문서', '# 검토 필요\n재검토암호는 REVIEW입니다.', {markdownNeedsReview: true}),
  entry('provider', '별도 제공자', '# 별도\n제공자암호는 OTHER입니다.', {provider: 'fabrix'}),
  entry('origin', '다른 사이트', '# 별도\n사이트암호는 FOREIGN입니다.', {url: 'https://other.example.test/origin'}),
];
const externalDocument = (id, title, text) => ({id, title, text, kind: 'folder', path: `${id}.md`, version: 'snapshot-v2'});
const external = {wikiId: 'external:folder:quality', sourceComplete: true, documents: [
  externalDocument('travel', '외부 출장 규정', '# 국내 출장\n숙박비 한도는 1박에 80,000원입니다.'),
  externalDocument('long', '장기 프로젝트 규정', '# 장기 프로젝트\n'+ '일반적인 프로젝트 안내입니다. '.repeat(2200) + '\n중간검수 담당자는 품질팀입니다.\n' + '일반적인 프로젝트 안내입니다. '.repeat(2200) + '\n최종인계 담당자는 운영팀입니다.'),
  externalDocument('table', '해외 출장 일비', '# 해외 출장 일비\n\n| 지역 | 일일 한도(USD) |\n| --- | --- |\n' + Array.from({length: 130}, (_, i) => `| 기타 지역 ${i} | 별도 확인 |\n`).join('') + '| 시드니 | 75 |'),
  externalDocument('code', '장비 신청', '# 장비 신청\nＡＢＣ 모델의 반납 기한은 14일입니다.'),
]};
function fact(documentId, quote, answers = []) {return {documentId, quote, answers};}
export function wikiQualityDataset() {
  const internal = siteWikiSnapshot({entries: internalEntries}, scope, FIXED_NOW);
  const id = path => `${origin}/${path}`;
  const cases = [
    ['internal-policy', 'internal', '국내 출장 숙박비 한도', [fact(id('travel'), '숙박비 한도는 1박에 55,000원입니다.', ['55,000', '55000', '5만 5천'])]],
    ['external-policy', 'external', '국내 출장 숙박비 한도', [fact('travel', '숙박비 한도는 1박에 80,000원입니다.', ['80,000', '80000', '8만'])]],
    ['exception', 'internal', '제주 출장 숙박비 한도와 사전 승인', [fact(id('exception'), '제주 숙박비 한도는 1박에 90,000원입니다.', ['90,000', '90000', '9만']), fact(id('exception'), '부서장 사전 승인이 필요합니다.', ['부서장'])]],
    ['cross-doc', 'internal', '국내 출장 일반 숙박비와 제주 예외 비교', [fact(id('travel'), '숙박비 한도는 1박에 55,000원입니다.', ['55,000', '55000']), fact(id('exception'), '제주 숙박비 한도는 1박에 90,000원입니다.', ['90,000', '90000'])]],
    ['markdown-spacing', 'internal', '휴가신청 제출 대상', [fact(id('leave'), '휴가 **신청**은 팀장에게 제출합니다.', ['팀장'])]],
    ['receipt', 'internal', '접수 완료 확인 기준', [fact(id('receipt'), '접수 번호가 표시되면 완료입니다.', ['접수 번호', '접수번호'])]],
    ['table-unit', 'internal', '출장 식비 한도', [fact(id('currency'), '| 식비 | 25,000 |', ['25,000', '25000']), fact(id('currency'), '| 항목 | 일일 한도(원) |', ['원'])]],
    ['long-middle-tail', 'external', '중간검수 최종인계 담당자', [fact('long', '중간검수 담당자는 품질팀입니다.', ['품질팀']), fact('long', '최종인계 담당자는 운영팀입니다.', ['운영팀'])]],
    ['distant-table-header', 'external', '시드니 출장 일비 한도와 단위', [fact('table', '| 시드니 | 75 |', ['75']), fact('table', '| 지역 | 일일 한도(USD) |', ['USD', '달러'])]],
    ['unicode', 'external', 'ABC 모델 반납 기한', [fact('code', 'ＡＢＣ 모델의 반납 기한은 14일입니다.', ['14일', '14 일'])]],
    ...['구규정암호', '폐기암호', '재검토암호', '제공자암호', '사이트암호'].map((query, index) => [`excluded-${index}`, 'internal', query, []]),
    ['unknown', 'external', '화성출장 우주선 보험 한도', []],
  ].map(([id, wiki, question, facts]) => {
    const snapshot = wiki === 'internal' ? internal : external;
    return {id, wiki, question, snapshot, retrievalExpectation: facts.length ? 'evidence' : id.startsWith('excluded-') ? 'empty' : 'unscored', expected: facts.map(f => {
      const doc = snapshot.documents.find(doc => doc.id === f.documentId);
      const start = doc?.text.indexOf(f.quote) ?? -1;
      if (start < 0 || doc.text.indexOf(f.quote, start + 1) >= 0) throw new Error(`Ambiguous gold range: ${id}`);
      return {...f, start, end: start + f.quote.length};
    })};
  });
  return {version: WIKI_DATASET_VERSION, cases};
}
