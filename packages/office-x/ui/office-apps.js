// App-specific capabilities are data; identity, typography and controls stay shared.
export const officeApps={
 excel:{name:'Excel',icon:'table',placeholder:'선택한 표에 대해 요청하세요',suggestions:[['금액 열 계산','수량과 단가를 곱해서 빈 금액 열을 채워줘.'],['주변 표 요약','선택한 셀 주변의 표를 읽고 핵심 수치를 요약해줘.'],['데이터 점검','선택한 표의 누락이나 이상한 값을 찾아줘.']]},
 word:{name:'Word',icon:'file',placeholder:'선택한 문단에 대해 요청하세요',suggestions:[['문단 다듬기','선택한 문단들을 간결하고 자연스럽게 다듬어줘.'],['맞춤법 교정','선택한 문단들의 맞춤법과 띄어쓰기를 교정해줘.'],['문서 요약','문서 개요를 읽고 핵심 내용과 구성을 요약해줘.'],['영어로 번역','선택한 문단들을 영어로 번역해줘. 문단 구조는 유지해줘.']]},
 powerpoint:{name:'PowerPoint',icon:'presentation',placeholder:'선택한 슬라이드에 대해 요청하세요',suggestions:[['발표 문구 다듬기','선택한 텍스트 상자들의 문구를 발표에 맞게 짧고 명확하게 다듬어줘.'],['제목과 본문 정리','선택한 슬라이드의 제목과 본문 문구를 간결하게 정리해줘.'],['발표 흐름 점검','프레젠테이션 개요를 읽고 슬라이드 간 흐름과 개선점을 알려줘.'],['발표 대본 초안','선택한 슬라이드를 읽고 발표 대본을 채팅에 작성해줘.']]}
};
