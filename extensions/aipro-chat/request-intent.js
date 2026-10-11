// Classifies whether a request asks for findings rather than a change. The
// answer must be positive on both sides: the request asks to be told something
// and names no operation that changes a page, a file or an account. Anything
// uncertain is NOT an information request, because that class relaxes
// intermediate reviews. This never grants permission for an operation.
const CHANGE_WORD = '작성|수정|편집|입력|등록|저장|전송|발송|게시|발행|업로드|다운로드|삭제|구매|결제|예약|배포|제출|변경|생성|채우|채워|넣어|붙여|보내|올려|고쳐|바꿔|반영' +
  '|옮겨|옮기|드래그|끌어|맞춰|토글|켜\\s*줘|꺼\\s*줘|켜\\s*주|꺼\\s*주|신청|가입|로그인|로그아웃' +
  // Marking a mail or an item changes it: "중요 표시하고 열어서 알려줘" asks for a
  // change and a finding (measured: W-02 was taken for a lookup).
  '|(?:중요|읽음|안\\s*읽음|별표|스팸)\\s*(?:표시|처리)' +
  // An action form of these verbs, not the adnominal form in "선택한 폴더" or "설정된 값".
  '|(?:선택|체크|해제|설정|이동|추가|제거|취소|승인|적용|실행)(?:해|하고|하여|하세요|하라|하기|시켜|시키)';
const CHANGE = new RegExp(`${CHANGE_WORD}|\\b(?:write|edit|save|submit|publish|post|upload|delete|purchase|book|move|drag|set|select|toggle|enable|disable|turn\\s+(?:on|off)|apply|sign\\s+(?:in|up)|log\\s+(?:in|out)|approve|cancel|add|remove)\\b`, 'i');
const ASK = /알려|찾아|조사|조회|확인|설명|요약|비교|대조|식별|정리|읽어|보여|밝혀|추천|골라|제시|계획을?\s*세워|일정을?\s*짜|뭐|무엇|언제|어디|누가|누구|몇|얼마|인지|\b(?:what|which|who|when|where|how\s+(?:many|much|long)|find|tell|show|summari[sz]e|explain|compare|list|look\s+up|check)\b/i;
// A forbidden operation: the change word followed closely by a negative ending.
// Several operations can share one ending ("등록/제출은 하지 마", "로그인하거나
// 신청하지 마"), and the ending can carry a helper noun ("예약은 진행하지 마").
// Only an alternative joins the list: "입력하고 저장하지 마" and "수정, 저장하지
// 말고" still ask for the first operation.
const FORBIDDEN = new RegExp(`(?:(?:${CHANGE_WORD})(?:\\s*(?:/|·|또는|및)\\s*|(?:하거나|거나|이나)\\s*))*(?:${CHANGE_WORD})[가-힣]{0,6}(?:\\s*(?:은|는|도|을|를))?\\s*(?:(?:진행|시도|수행)\\s*)?(?:하지|하지는|지는|지)\\s*(?:마|말)[가-힣]{0,6}`, 'g');
const FORBIDDEN_EN = /\b(?:do not|don't|never|without)\s+(?:\w+\s+){0,2}?(?:writ|edit|sav|submit|publish|post|upload|delet|purchas|book|mov|drag|set|select|toggl|enabl|disabl|apply|approv|cancel|add|remov)\w*\b/gi;
// A noun built on a change word names a fact to report, not an operation:
// "수정일" is a date, "작성자" a person, "변경 이력" a record.
// Joined nouns share the fact ("발행/갱신 시각"), and a requirement can sit
// between them ("예약 필요 여부", "예약 가능 여부").
const FACT_WORD = '작성|수정|등록|게시|발행|생성|변경|삭제|저장|업로드|예약|결제|구매|제출|신청|가입|로그인|갱신';
const FACT_NOUN = new RegExp(`(?:${FACT_WORD})(?:\\s*[/·]\\s*(?:${FACT_WORD}))*\\s?(?:(?:필요|가능|불가|필수)\\s?)?(?:일자|일시|일|날짜|시각|시간|자|본|내역|이력|여부|상태|현황|건수|번호|기간|방법|절차|조건|비용|수수료)(?![가-힣]*(?:해|하고|하여|하세요|하라))`, 'g');
// A property of what is looked up: "로그인 필요 서비스", "예약 필수 전시".
const REQUIREMENT = /(?:로그인|가입|예약|신청|결제)(?:이|가)?\s?(?:필요|필수|불필요)(?:한|하지\s*않은)?(?=\s)/g;
// Answer formatting: attach a source, link or citation to the reply.
const CITATION = /(?:출처|링크|근거|인용|참고\s*자료|주소|URL)[가-힣]{0,2}(?:\s*[가-힣]{0,4}){0,2}\s*(?:붙여|넣어|달아|첨부)/gi;

// "반영" changes a page or a document unless the request asks for a plan or a
// recommendation and names nothing to write into: there the conditions are
// taken into the answer ("식사 40분을 반영해 계획을 세워 줘").
const COMPOSED = /계획을?\s*세워|일정을?\s*짜|추천해|골라\s*줘/;
const WRITE_TARGET = /페이지|문서|양식|폼|메일|본문|안내문|초안|설정|시트|셀|필드|입력란|게시글|화면에/;

export function isInformationRequest(goal) {
  if (typeof goal !== 'string' || !goal.trim() || goal.length > 2000) return false;
  let request = goal.replace(FORBIDDEN, ' ').replace(FORBIDDEN_EN, ' ').replace(CITATION, ' ').replace(FACT_NOUN, ' ').replace(REQUIREMENT, ' ');
  if (COMPOSED.test(request) && !WRITE_TARGET.test(request)) request = request.replace(/반영[가-힣]*/g, ' ');
  return ASK.test(request) && !CHANGE.test(request);
}
