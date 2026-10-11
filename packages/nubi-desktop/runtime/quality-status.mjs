export function qualityLabel(quality){
  if(!quality)return '문법 검사 전';
  return ({passed:'문법 검사 완료',existing_issues:`기존 문법 오류 ${quality.errorCount}개`,unsupported:'자동 문법 검사 미지원',blocked:'새 문법 오류 발견',incomplete:'문법 검사 일부 완료',unavailable:'문법 검사 미완료'})[quality.state]||'문법 검사 미완료';
}
