import {VOC_ERRORS} from './voc-tools.js';
import {MCP_ERRORS} from './mcp-config.js';
export const ORIGIN = 'https://aipro.sdsdev.co.kr';
export const MODEL_CATALOG_VERSION = 6;
export const PROVIDER_LABELS = {aipro: 'AI Pro', chatgpt: 'ChatGPT', fabrix: 'FabriX'};
export const PAGE_ORIGINS = ['http://*/*', 'https://*/*'];
export const SSO_ORIGIN = 'https://epsso.samsung.net';
export function callbackOriginKind(value) {
  if (value === undefined) return 'absent';
  const origin = String(value).replace(/\/+$/, '').toLowerCase();
  return origin === ORIGIN ? 'aipro' : origin === SSO_ORIGIN ? 'epsso' : 'other';
}
export const DEFAULT_SETTINGS = {loginRoute: 'cli', mode: 'browser', modelId: 'QWEN3.8-27B-FP8-256K'};
export const ERROR_TEXT = {
  resume_page_required: '이 작업에서 사용하던 페이지를 연결한 뒤 이어서 진행해 주세요.',
  recording_draft_pending:'저장하지 않은 녹화가 있습니다. 먼저 저장하거나 다시 녹화를 선택해 주세요.',
  recording_draft_changed:'녹화 초안이 바뀌었습니다. 내용을 다시 확인해 주세요.',
  notification_permission:'알림 권한을 허용해 주세요.',
  routine_limit:'저장한 작업이 30개입니다. 사용하지 않는 작업을 삭제해 주세요.',
  browser_policy_blocked:'조직 정책으로 이 작업이 제한되어 있습니다.',
  browser_policy_invalid:'조직 정책을 확인할 수 없습니다.',
  download_permission:'설정에서 다운로드 추적 권한을 허용해 주세요.',
  download_missing:'이 대화의 다운로드 기록을 찾지 못했습니다.',
  agent_input_invalid: '메시지를 확인해주세요.',
  agent_input_full: '대기 메시지가 많습니다. 먼저 정리해주세요.',
  agent_input_changed: '대기열이 바뀌었습니다. 순서를 다시 확인해주세요.',
  agent_input_closed: '작업 상태가 바뀌었습니다. 메시지를 다시 보내주세요.',
  agent_input_draft: '작성 중인 메시지를 먼저 정리해주세요.',
  ...VOC_ERRORS,...MCP_ERRORS,
  attachment_type: '이미지, PDF, Word(docx) 또는 텍스트 소스를 선택해주세요.',
  attachment_size: '이미지는 4 MB, 문서와 텍스트는 8 MB까지입니다. 한 번에 총 8 MB까지 첨부할 수 있습니다.',
  attachment_count: '한 번에 파일 4개까지 첨부할 수 있습니다.',
  attachment_document: '문서를 읽지 못했습니다. PDF 또는 Word(docx) 파일을 확인해주세요.',
  attachment_document_empty: '문서에서 텍스트를 찾지 못했습니다. 필요한 부분을 이미지로 첨부해주세요.',
  attachment_document_size: 'PDF는 2,000쪽, 추출한 본문은 400만 자와 12 MB까지 읽을 수 있습니다.',
  attachment_document_password: '암호가 없는 문서를 첨부해주세요.',
  attachment_document_timeout: '문서를 읽는 데 시간이 오래 걸립니다. 필요한 부분만 첨부해주세요.',
  attachment_empty: '내용이 있는 파일을 선택해주세요.',
  attachment_invalid: '파일을 읽지 못했습니다. 다른 파일을 선택해주세요.',
  attachment_encoding: 'UTF-8 텍스트 파일을 선택해주세요.',
  attachment_storage: '파일을 보관하지 못했습니다. 다시 시도해주세요.',
  attachment_storage_full: '첨부 보관 공간이 찼습니다. 필요 없는 대화를 삭제해주세요.',
  attachment_missing: '첨부 파일을 찾지 못했습니다. 파일을 다시 첨부해주세요.',
  attachment_vision: '이미지를 읽을 수 있는 모델로 바꾸거나 이미지를 제거해주세요.',
  openwiki_changed: '조회 중 위키가 바뀌었습니다. 바뀐 문서로 다시 확인해 주세요.',
  openwiki_upgrade_required: 'OpenWiki 서버를 업데이트하거나 설정에서 위키 폴더를 선택해 주세요.',
  openwiki_source_invalid: '위키 문서 범위를 확인하지 못했습니다. 연결을 다시 확인해 주세요.',
  project_address: '로컬 OpenWiki 주소를 확인해 주세요.',
  project_permission: 'OpenWiki 사이트 접근을 허용해 주세요.',
  project_pairing: '연결 코드를 읽지 못했습니다. OpenWiki를 업데이트한 뒤 다시 연결해 주세요.',
  project_expired: '프로젝트 연결이 만료됐습니다. 다시 연결해 주세요.',
  project_invalid: 'OpenWiki 응답을 읽지 못했습니다. 서버 버전을 확인해 주세요.',
  project_scope: '이 프로젝트에서 읽을 수 없는 파일입니다.',
  project_not_found: '문서나 파일을 찾지 못했습니다.',
  project_arguments: '검색어와 파일의 줄 범위를 확인해 주세요.',
  project_unavailable: 'OpenWiki에 연결하지 못했습니다. 서버가 실행 중인지 확인해 주세요.',
  project_changed: '프로젝트 연결이 바뀌었습니다. 다시 요청해 주세요.',
  project_storage: '폴더 설정을 불러오지 못했습니다. 다시 시도해 주세요.',
  wiki_folder_permission: '설정에서 OpenWiki 폴더 읽기를 다시 허용해 주세요.',
  wiki_folder_unavailable: 'OpenWiki 폴더를 읽지 못했습니다. 설정에서 다시 선택해 주세요.',
  wiki_folder_empty: 'OpenWiki 문서가 있는 폴더를 선택해 주세요.',
  wiki_folder_scan_limit: '폴더가 너무 큽니다. openwiki 폴더를 직접 선택해 주세요.',
  wiki_folder_unsupported: '전체 화면에서 OpenWiki 폴더를 선택해 주세요.',
  draft_edit_unavailable: '직접 편집할 입력란이 없습니다. 채팅으로 수정할 내용을 알려주세요.',
  draft_edit_too_large: '수정 내용이 너무 큽니다. 나누어 반영해주세요.',
  approval_required: '최종 반영 전에 승인이 필요합니다.',
  approval_verification_required: '초안을 확인한 뒤 승인을 요청합니다.',
  approval_changed: '페이지나 초안이 바뀌었습니다. 다시 확인한 뒤 승인해주세요.',
  approval_outcome_unknown: '실행 결과를 확인하고 있습니다. 같은 작업을 다시 누르지 마세요.',

  capture_save_failed: '이미지를 보관하지 못했습니다. 다시 요청해 주세요.',
  capture_too_large: '페이지가 커서 구간별 캡처가 필요합니다.',
  capture_incomplete: '캡처 범위가 달라 화면을 다시 확인해야 합니다.',
  capture_timeout: '화면 캡처가 지연됐습니다. 현재 페이지를 다시 확인합니다.',
  debugger_unavailable: '이 브라우저에서 조작 연결 기능을 사용할 수 없습니다.',
  debugger_conflict: '다른 디버거와 충돌했습니다. 해당 탭의 개발자 도구나 다른 자동화를 닫고 다시 연결해주세요.',
  debugger_policy_blocked: '브라우저 정책이 조작 연결을 제한했습니다.',
  debugger_protocol_unsupported: '이 브라우저가 필요한 조작 기능을 지원하지 않습니다.',
  debugger_attach_failed: '브라우저 조작 연결에 실패했습니다. 현재 페이지와 연결 상태를 확인해주세요.',
  debugger_disconnected: '브라우저 조작 연결이 끊겼습니다. 이전 동작의 결과를 확인한 뒤 다시 연결해주세요.',
  scroll_target_required: '이동할 스크롤 영역을 확인해야 합니다.',
  scroll_not_moved: '스크롤이 이동하지 않았습니다. 현재 영역을 다시 확인합니다.',
  capture_storage_full: '이미지 보관 공간이 가득 찼습니다. 필요한 이미지를 다운로드한 뒤 새 대화를 시작해 주세요.',
  question_changed: '이미 답변한 질문입니다. 현재 대화에서 계속해 주세요.',
  image_unavailable: '원본 이미지를 가져오지 못했습니다. 이미지가 열린 페이지에서 다시 요청해 주세요.',
  image_too_large: '20 MB 이하 이미지만 가져올 수 있습니다.',
  fabrix_endpoint: 'HTTPS Endpoint를 확인해 주세요.',
  fabrix_credentials: 'Client Key와 API Token을 확인해 주세요.',
  fabrix_network: 'FabriX에 연결하지 못했습니다. 회사망과 Endpoint를 확인해 주세요.',
  fabrix_tool_protocol: 'FabriX 도구 응답 형식이 맞지 않습니다. 설정의 연결 진단을 확인해 주세요.',
  fabrix_tool_test: '이 모델의 도구 호출을 확인하지 못했습니다. 다른 모델을 선택해 주세요.',
  fabrix_test_expired: '연결 테스트를 다시 실행해 주세요.',
  fabrix_test_timeout: '연결 테스트 시간이 초과되었습니다. 다시 시도해 주세요.',
  fabrix_model_limits: '모델의 컨텍스트 길이와 최대 응답 토큰을 확인해 주세요.',
  fabrix_media_unsupported: '이 FabriX 연결은 텍스트와 DOM 작업을 지원합니다. 이미지 입력은 지원하지 않습니다.',
  browser_stale: '화면이 바뀌었습니다. 다시 확인합니다.',
  browser_content_changed: '문서가 바뀌었습니다. 최신 내용을 다시 읽습니다.',
  page_content_empty: '본문을 찾지 못했습니다. 화면 구조를 확인합니다.',
  page_content_limit: '문서가 큽니다. 필요한 구간을 찾아 확인합니다.',
  browser_action_failed: '동작 결과를 확인하지 못했습니다. 현재 화면을 다시 확인합니다.',
  quota_unauthorized: '이 로그인으로 계정 한도를 조회할 수 없습니다.',
  quota_unavailable: '계정 한도를 조회할 수 없습니다.',
  quota_network: '계정 한도에 연결하지 못했습니다.',
  quota_invalid: '계정 한도 응답을 읽지 못했습니다.',
  quota_rate_limited: '잠시 후 다시 조회해 주세요.',
  chatgpt_callback_invalid: 'ChatGPT 로그인 응답이 일치하지 않습니다. 다시 로그인해 주세요.',
  chatgpt_login_denied: 'ChatGPT 로그인이 취소되었습니다.',
  chatgpt_exchange_rejected: 'ChatGPT에서 인증을 거부했습니다. 다시 로그인해 주세요.',
  chatgpt_token_invalid: 'ChatGPT 인증 응답을 읽지 못했습니다.',
  chatgpt_network: 'ChatGPT에 연결하지 못했습니다. 네트워크를 확인해 주세요.',
  invalid_sender: '이 로그인 창에서 시작한 요청이 아닙니다.',
  no_attempt: '로그인 시도가 종료되었습니다. 다시 로그인하세요.',
  invalid_token: '선택한 인증 방식과 수신값이 맞지 않습니다. 설정에서 JWT / API key를 확인하세요.',
  expired_token: '인증값이 만료되었습니다. 다시 로그인하세요.',
  callback_code_received: '로그인 코드는 받았지만 요청에 인증값이 없습니다.',
  callback_code_invalid: '로그인 응답이 올바르지 않습니다. 다시 로그인하세요.',
  exchange_network: 'AI Pro 인증 서버에 연결하지 못했습니다. 회사망 연결을 확인하세요.',
  exchange_timeout: '인증 응답이 지연되고 있습니다. 다시 로그인하세요.',
  exchange_rejected: 'AI Pro에서 로그인 코드를 거부했습니다. 다시 로그인하세요.',
  exchange_invalid_response: 'AI Pro 인증 응답을 읽지 못했습니다. 연결 진단을 확인하세요.',
  exchange_interrupted: '인증 처리가 중단되었습니다. 다시 로그인하세요.',
  callback_receiver_unavailable: '콜백 수신을 시작하지 못했습니다. 확장 권한과 회사 브라우저 정책을 확인하세요.',
  callback_receiver_detached: '콜백 수신이 중단되었습니다. 로그인 탭의 개발자 도구를 닫고 다시 로그인하세요.',
  callback_receiver_failed: '콜백 응답을 처리하지 못했습니다. 다시 로그인하세요.',
  callback_body_unavailable: '콜백 본문을 읽지 못했습니다.',
  origin_not_allowed: '허용되지 않은 페이지의 콜백입니다.',
  method_not_allowed: '지원하지 않는 콜백 요청입니다.',
  callback_missing: '콜백은 감지했지만 지원하는 인증값 필드가 없습니다.',
  login_timeout: '로그인 응답이 도착하지 않았어요. 새 로그인을 시작해 주세요.',
  login_closed: '로그인 창이 닫혔습니다. 다시 로그인할 수 있습니다.',
  bridge_failed: '로그인 연결 코드에서 전달을 완료하지 못했습니다.',
  no_credential: '로그인이 필요합니다.',
  model_required: '모델을 선택해 주세요.',
  busy: '다른 채팅 창에서 답변을 생성 중입니다.',
  too_long: '대화가 너무 깁니다. 새 대화를 시작하세요.',
  conversation_changed: '다른 대화로 전환됐습니다. 현재 대화를 확인해 주세요.',
  conversation_missing: '이 대화는 삭제되었거나 찾을 수 없습니다.',
  conversation_title: '대화 이름을 입력해 주세요.',
  storage_failed: '브라우저에 저장하지 못했습니다. 입력값을 유지하고 다시 시도하세요.',
  unauthorized: '다시 로그인해 주세요.',
  forbidden: '이 계정 또는 클라이언트의 모델 접근 권한이 없습니다.',
  rate_limited: '사용 한도에 도달했습니다. 잠시 후 다시 시도하세요.',
  invalid_model: '선택한 모델을 사용할 수 없습니다. 모델 목록을 새로고침해 주세요.',
  request_format: '모델이 대화나 도구 형식을 거절했습니다. 진행된 작업은 유지됩니다.',
  request_rejected: '모델 서버가 요청을 거절했습니다. 연결 진단에서 원인을 확인할 수 있습니다.',
  request_image: '이 모델 연결에서 이미지를 받지 못했습니다. 진행된 작업은 유지됩니다.',
  request_endpoint: '모델 요청 주소를 찾지 못했습니다. 연결 진단을 확인해 주세요.',
  model_timeout: '모델 응답을 기다리지 못했습니다. 잠시 후 이어서 진행하세요.',
  model_stream_incomplete: '모델 응답 연결이 끊겼습니다. 작업을 이어서 다시 시도해 주세요.',
  network: '모델 서버에 연결하지 못했습니다. 회사망이나 VPN을 확인하세요.',
  response_invalid: '응답을 끝까지 읽지 못했습니다. 다시 시도해 주세요.',
  plan_read_only: '계획 검토 중에는 페이지를 변경하지 않습니다. 검토가 끝나면 새 메시지로 실행을 요청해 주세요.',
  tools_unavailable: '이 확장에 연결되지 않은 도구를 요청했습니다. 필요한 내용을 메시지로 보내주세요.',
  wiki_context_missing: '대상 페이지를 먼저 확인해 주세요.',
  wiki_not_found: '현재 사이트에서 문서를 찾지 못했습니다.',
  wiki_stale: '화면이 바뀌었거나 확인한 지 오래됐습니다. 현재 페이지를 다시 확인해 주세요.',
  wiki_changed: '위키가 갱신됐습니다. 다시 검색해 주세요.',
  wiki_focus_required: '찾을 내용을 짧게 지정해 주세요.',
  wiki_disabled: '설정에서 사이트 위키를 켜주세요.',
  wiki_source_missing: '원본 화면을 다시 확인해야 합니다. /wiki로 새 초안을 만들어 주세요.',
  wiki_draft_invalid: '위키 초안을 만들지 못했습니다. 초안 만들기를 다시 눌러주세요.',
  skill_source_missing: '브라우저 작업을 완료한 뒤 스킬로 만들어 주세요.',
  skill_draft_invalid: '스킬 초안을 만들지 못했습니다. 스킬 메뉴에서 다시 시도해 주세요.',
  skill_archive_invalid: '스킬 ZIP의 파일 구성과 크기를 확인하세요. 최대 200KB까지 지원합니다.',
  skill_command_missing: '등록된 스킬을 찾지 못했습니다. /를 입력해 선택하세요.',
  skill_command_ambiguous: '같은 명령의 스킬이 있습니다. 이름을 구분해 주세요.',
  skill_answer_too_long: '답변은 4,000자 이내로 적어주세요.',
  skill_invalid: '스킬 이름과 지침을 확인하세요. 지침은 16,000자까지 등록할 수 있습니다.',
  page_required: '대상 웹페이지에서 스킬을 실행해 주세요.',
  page_target_missing: '분석할 웹페이지를 열어 주세요.',
  page_restricted: '로그인 페이지에서는 스킬을 사용할 수 없습니다.',
  page_permission: '웹페이지 접근을 허용한 뒤 다시 전송해 주세요.',
  page_changed: '페이지가 변경되었습니다. 다시 연결해 주세요.',
  workspace_changed: '누비 작업 탭이 닫히거나 이동했습니다. 대상 페이지를 다시 연결해 주세요.',
  workspace_unavailable: '누비 작업 탭을 열지 못했습니다. 다시 시도해 주세요.',
  workspace_loading: '누비 작업 페이지가 아직 열리는 중입니다. 잠시 후 이어서 진행해 주세요.',
  fill_invalid: '입력란이 변경되었거나 지원하지 않는 값입니다. 다시 확인해 주세요.',
  fill_not_retained: '사이트에서 입력값을 유지하지 않았습니다. 페이지를 확인해 주세요.',
  fill_format_unsupported: '이 입력란은 서식 있는 글을 받지 않습니다. 일반 글로 입력합니다.',
  observe_timeout: '페이지가 응답하지 않아 화면을 읽지 못했습니다. 다른 주소로 이동해 다시 시도합니다.',
  agent_stalled: '같은 작업이 반복되어 중단했습니다. 요청이나 페이지 상태를 확인해 주세요.',
  verification_required: '작업 결과를 아직 확인하지 못했습니다. 현재 상태에서 이어서 확인할 수 있습니다.',
  replay_unavailable: '다시 실행할 기록이 없습니다. 모델과 함께 다시 요청해 주세요.',
  replay_values_missing: '다시 실행에 넣을 값을 모두 입력해 주세요.',
  replay_stopped: '기록한 절차를 끝까지 실행하지 못해 멈췄습니다.',
  replay_memory_missing: '이 절차의 스크립트나 첨부 파일 내용은 메모리에만 있어, 브라우저를 다시 켠 뒤에는 모델 없이 다시 실행할 수 없습니다. 모델과 함께 다시 요청해 주세요.',
  goal_review_failed: '결과 검토 응답을 확인하지 못했습니다. 작업 상태를 유지한 채 다시 확인할 수 있습니다.',
  goal_incomplete: '아직 확인이 필요한 항목이 있습니다.',
  question_failed: '질문을 표시하지 못했습니다. 다시 시도해 주세요.',
  plan_failed: '작업 계획을 만들지 못했습니다. 다시 시도하세요.',
  drag_cross_frame: '다른 프레임 사이의 드래그는 지원하지 않습니다.',
  drag_approval_required: '최종 반영은 페이지의 실행 버튼으로 승인받습니다.',
  verification_failed: '요청한 결과와 현재 페이지가 일치하지 않습니다.',
  tool_arguments_invalid: '도구 입력 형식을 확인해야 합니다.',
  storage_key_unavailable: '저장 항목을 다시 확인해야 합니다.',
  storage_unavailable: '이 페이지의 저장 정보에 접근할 수 없습니다.',
  fill_no_receipt: '아직 확인할 입력 결과가 없습니다.',
  response_filtered: '모델 서버에서 응답을 제한했습니다. 질문을 바꿔서 시도하세요.',
  output_limit: '응답 생성을 이어가지 못했습니다. 진행된 작업은 유지됩니다.',
  chat_timeout: '응답 대기 시간이 초과되었습니다. 잠시 후 다시 시도하세요.',
  upstream: 'AI 서버에서 오류가 발생했습니다. 연결 진단을 확인해 주세요.',
  interrupted: '작업 실행이 중단됐습니다. 이어서 확인할 수 있습니다.',
  cancelled: '작업을 중지했습니다.',
  context_compaction_failed: '대화를 요약하지 못했습니다. 원본은 유지됩니다. 다시 시도해 주세요.',
  context_input_too_large: '최근 요청이 모델의 입력 한도를 넘습니다. 내용을 나누거나 큰 모델을 선택해 주세요.',
  read_timeout: '자료 읽기가 지연되었습니다. 확인한 내용은 유지됩니다.',
  context_overflow: '모델의 컨텍스트 한도에 도달했습니다. 컨텍스트를 압축하고 다시 시도해 주세요.',
  models_invalid: '모델 목록을 읽지 못했습니다.',
  models_empty: '사용 가능한 모델이 없습니다.',
  code_exchange_required: '로그인 결과에서 JWT를 받지 못했습니다. 다시 로그인해 주세요.',
  callback_jwt_missing: '로그인 결과에서 JWT를 받지 못했습니다. 다시 로그인해 주세요.',
  login_failed: '로그인을 완료하지 못했습니다. 다시 시도해 주세요.',
};
// The model's context window in tokens. AI Pro's model list has named it
// context_length and, in its open_api entries, context (glm-5.2 524288,
// qwen3.8-27b 262144, gpt-oss-120b 131072); vLLM names it max_model_len. Unread,
// the window was unknown: the context gauge stayed empty and history was
// summarized by the default budget instead of the model's own. Never taken
// from max_input_tokens, which is a separate limit.
export const windowTokens = model => {
  for (const value of [model?.context_length, model?.context, model?.context_window, model?.max_model_len, model?.max_context_length]) {
    const tokens = typeof value === 'string' && /^\d{4,8}$/.test(value.trim()) ? Number(value) : value;
    if (Number.isSafeInteger(tokens) && tokens > 0) return tokens;
  }
  return null;
};
export function inspectModelList(payload) {
  if (!Array.isArray(payload?.modelList) || payload.ok === false || payload.success === false) fail('models_invalid');
  const summary = {received: payload.modelList.length, usable: 0, excluded: {target: 0, agent: 0, name: 0, duplicate: 0}};
  const validName = model => typeof model?.name === 'string' && !!model.name.trim() && model.name.trim().length <= 200;
  // AI Pro exposes these models through the same completion API regardless of classification.
  const seen = new Set();
  const models = payload.modelList.filter(m => {
    if (!validName(m)) { summary.excluded.name++; return false; }
    return true;
  })
    .map(m => ({name: m.name.trim(), displayName: typeof m.display_name === 'string' && m.display_name.trim() ? m.display_name.trim().slice(0, 200) : m.name.trim(), ...(typeof m.supports_images === 'boolean' ? {supportsImages: m.supports_images} : {}), sortSeq: Number.isFinite(m.sort_seq) ? m.sort_seq : Number.MAX_SAFE_INTEGER, maxInputTokens: Number.isSafeInteger(m.max_input_tokens) && m.max_input_tokens > 0 ? m.max_input_tokens : null, contextLength: windowTokens(m), ...(Number.isSafeInteger(m.max_output_tokens) && m.max_output_tokens > 0 ? {maxOutputTokens: m.max_output_tokens} : {})}))
    .sort((a, b) => a.sortSeq - b.sortSeq || a.displayName.localeCompare(b.displayName))
    .filter(m => {if (seen.has(m.name)) { summary.excluded.duplicate++; return false; } seen.add(m.name); return true;});
  summary.usable = models.length;
  return {models, summary};
}
export function parseModelList(payload) { return inspectModelList(payload).models; }
export function fail(code) { throw new Error(code); }
export function cleanSettings(value = {}) {
  return {loginRoute: DEFAULT_SETTINGS.loginRoute, mode: value.mode === 'apiKey' ? 'apiKey' : 'browser', modelId: String(value.modelId || '').trim().slice(0, 200) || DEFAULT_SETTINGS.modelId};
}
export function cleanCredential(value, mode, now = Date.now()) {
  if (typeof value !== 'string') fail('invalid_token');
  const token = value.trim().replace(/^["']|["']$/g, '').replace(/^(?:jwt=|token=|jwt\s+|bearer\s+)/i, '').trim().replace(/^["']|["']$/g, '');
  if (token.length < 8 || token.length > 16384 || /[\s\x00-\x1f]/.test(token)) fail('invalid_token');
  let expiresAt = null;
  if (mode === 'browser') {
    try {
      const pieces = token.split('.');
      if (pieces.length !== 3) fail('invalid_token');
      const encoded = pieces[1].replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
      if (!claims || typeof claims !== 'object' || Array.isArray(claims)) fail('invalid_token');
      if (Number.isFinite(claims.exp)) expiresAt = claims.exp * 1000;
    } catch { fail('invalid_token'); }
    if (expiresAt !== null && expiresAt <= now) fail('expired_token');
  }
  return {token, mode, expiresAt, receivedAt: now};
}
export function callbackMatches(value, port) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === String(port) && !url.username && !url.password;
  } catch { return false; }
}
export function endpoint(mode) { return `${ORIGIN}/${mode === 'apiKey' ? 'open/' : ''}api/v1/chat/completions`; }
export function httpError(status) {
  return status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 429 ? 'rate_limited' : [400, 404, 422].includes(status) ? 'invalid_model' : 'upstream';
}
