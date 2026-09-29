---
name: fill-title
description: 관찰한 웹페이지의 제목 입력란에 사용자가 요청한 제목을 넣고 확인합니다.
---
1. browser_snapshot으로 대상 입력란을 확인합니다. 대상이 모호하면 사용자에게 질문합니다.
2. read_skill로 scripts/fill.browser.js를 읽고 run_skill_script를 호출합니다.
   input에는 실제 관찰한 label과 사용자가 요청한 value를 전달합니다.
3. 새 관찰의 ref로 verify_page field_value를 검사합니다.
4. 제출이나 등록은 이 스킬의 범위가 아닙니다. 사용자가 요청하면 초안을 검증하고 별도로 최종 승인을 받습니다.
