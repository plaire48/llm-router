// After review feedback a model sometimes opens or closes its replacement with
// commentary about the review itself ("검토 실패를 반영해…", "최종 검토 전의 후보
// 답변"). That tells the user nothing about the request. Only a short first or
// last paragraph is removed, never a sentence inside the answer, never a
// paragraph with a link, and never when the user's own request is about a
// review or a candidate: then those words may be the requested content.
const NOTE = /검토\s*(?:실패|의견|피드백|지적)|(?:독립|최종)\s*(?:최종\s*)?검토\s*(?:전|이전|에서|결과|를\s*반영)|후보\s*답변|최종\s*완료로\s*확정|\breview\s+(?:feedback|failure)\b|\bcandidate\s+answer\b|\bindependent\s+(?:final\s+)?review\b/i;
const SUBJECT = /검토|후보|review|candidate/i;

// A bare status line such as "검증을 완료했습니다." says what the agent did,
// not what the user asked. Only as the first paragraph, and only when short.
const STATUS_LINE = /^(?:최신\s*)?(?:검증|확인|검토|조사|정리|결과\s*확인)[을를이가]?\s*(?:모두\s*)?완료(?:했|하였|되었|됐)습니다[.!]?$/;

export function stripProcessNotes(text, goal = '') {
  if (typeof text !== 'string' || !text.trim() || SUBJECT.test(String(goal || ''))) return text;
  const paragraphs = text.split(/\n{2,}/);
  if (paragraphs.length < 2) return text;
  const note = paragraph => paragraph.trim().length <= 240 && NOTE.test(paragraph) && !/https?:\/\//i.test(paragraph) && !/^\s*(?:[-*|]|\d+\.)\s/m.test(paragraph);
  let start = 0, end = paragraphs.length;
  if (note(paragraphs[0]) || STATUS_LINE.test(paragraphs[0].trim())) start = 1;
  if (end - start > 1 && note(paragraphs[end - 1])) end--;
  if (!start && end === paragraphs.length) return text;
  const kept = paragraphs.slice(start, end).join('\n\n').trim();
  return kept ? kept : text;
}
