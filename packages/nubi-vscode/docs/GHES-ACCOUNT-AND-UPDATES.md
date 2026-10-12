# GHES 계정과 누비 기능 업데이트

2026-10-01. 공유 원본과 주 제품의 `nubi/`에 구현했다. 실제 회사 인증과 Windows 설치 성공은 별도 검증이다.

## 화면과 CX

왼쪽 메뉴바 맨 아래는 원형 사용자 이미지 하나다. 검증된 GHES 사진을 표시하고 사진이 없거나 읽지 못하면 이름의 첫 글자, 비로그인은 공통 사람 아이콘으로 표시한다. 접근성 이름과 툴팁으로 계정을 식별한다.

클릭하면 같은 CX 모달을 연다. E2E Report의 `LoginScreen.jsx`, `AccountProfile.jsx`, `login.css`, `account-profile.css`를 실제로 읽고 로그인과 프로필의 배치를 재사용했다. 연결 전에는 누비 캐릭터, 제품명, 한 줄 설명과 회사 로그인만 보인다. 연결 후에는 큰 원형 사진과 이름, 아이디, 서버에서 확인한 소속과 이메일만 표시한다. 소속과 이메일은 의미 있는 아이콘과 툴팁으로 표시하고 비어 있는 정보는 만들지 않는다. 새로고침, GitHub 프로필 보기와 로그아웃은 공통 아이콘 버튼이다. 저장소와 업데이트는 설정을 펼쳐 사용한다. 메인 대화와 초안, 키보드 복귀를 유지한다.

| 항목 | 공통 토큰과 적용 |
|---|---|
| 색 | 강조 `--deck-blue` #3182F6, 흰 글자 버튼 `--deck-blue-deep` #1B64DA, 옅은 배경 `--deck-blue-soft` #E8F1FE |
| 글자 | Pretendard / Noto Sans KR, 이름/제품명 `--cx-type-title`, 본문 `--cx-type-body`, 보조 `--cx-type-caption` |
| 여백 | 실제 존재하는 CX 4/8/12/16/24/32px 토큰만 사용. 계정 본문 inset은 32px, 좁은 화면은 24px. 영역 간격 24px, 정보 행 간격 16px와 행간 24px |
| 크기 | 하단 사진 28px, 프로필 사진 72px, 로그인 버튼 최소 44px, 동작 아이콘 20px, 정보 아이콘 16px |
| 모션 | 기존 캐릭터 idle와 `deck-rise`, `deck-disclosure-enter`, `--deck-pop`, `--deck-feedback`, `--deck-ease`. 모션 감소에서는 동작하지 않음 |

계정 CSS의 모든 참조 토큰이 실제 렌더링에서 정의됐는지 검사한다. 정의되지 않은 토큰과 일반 h3 스타일에 의한 제목 크기 덮어쓰기를 고쳤다. 새 CX 패키지나 애니메이션 라이브러리를 추가하지 않았다.

## 로그인과 SAML

- 호스트는 `https://code.sdsdev.co.kr`로 고정한다. 회사 GitHub App의 공개 Client ID 기본값은 `Iv1.8526278f12b92180`이다. 실제 앱 설정은 아직 확인하지 못했다. 변경은 사용자 전역 machine 설정 `nubi.ghes.clientId`에서만 읽고 확장 재시작 후 적용한다. 프로젝트 설정을 신뢰하지 않는다.
- Device Flow 활성화와 앱의 저장소 설치를 회사에서 확인해야 한다. 스킬은 `Manufacturing-IT/ai_workspace`, 릴리스는 `Manufacturing-IT/nuri`, Contents 읽기 권한이 필요하다. 사용자 권한과 앱 설치 범위의 교집합으로 접근한다.
- 확장 호스트가 로그인 코드를 발급받고 `/login/device`를 기본 브라우저로 연다. GHES가 회사 SAML IdP 로그인을 처리한다. 누비는 SAML 인증 서버나 IdP 설정을 만들지 않고 암호, SAML assertion, Client Secret, Private Key를 받지 않는다.
- 취소, 만료, 거절과 `slow_down`을 처리하고 `/api/v3/user`의 사용자 ID를 확인한 뒤에만 연결됨으로 처리한다. 인증 토큰은 host/clientId와 함께 VS Code SecretStorage에 보관한다. 웹뷰, 모델, 프로젝트, 로그와 Git URL에는 전달하지 않는다. refresh token을 보관하지 않고 만료 시 다시 로그인한다.
- 보호된 작업 직전에 사용자를 재확인한다. 계정 변경, 만료와 로그아웃은 이전 요청과 개인 마켓플레이스 캐시를 폐기한다. 설치된 스킬은 유지한다. 로그인 뒤 자동으로 이어가는 것은 사용자가 요청한 마켓플레이스 읽기뿐이며 에이전트나 설치를 자동 실행하지 않는다.
- 보호된 아바타는 같은 GHES의 제한된 PNG/JPEG/GIF/WebP 바이트로 받아 웹뷰에 전달한다. 외부 URL과 SVG에는 인증을 보내지 않는다. TLS 검증을 해제하지 않는다.

## 저장소와 스킬

동일한 검증 계정을 GitHub App에 설치된 저장소 목록과 스킬 마켓플레이스에 사용한다. 저장소 선택은 VS Code native QuickPick, 복제는 기존 Git 확장이다. GHES HTTPS 인증은 Git의 공식 CredentialsProvider/askpass 경계로만 전달한다. Git 확장이 없거나 프로젝트가 신뢰되지 않으면 중단한다. 임의 URL, 셸 명령, 자격 증명 파일과 Git config를 웹뷰에서 만들지 않는다. 다른 Git 호스트와 SSH는 기존 VS Code/GCM 경로를 유지한다.

## 누비 기능 업데이트

현재 구현은 GHES Release의 **누비 기능 VSIX** 설치다. Code-OSS 실행 파일이나 Windows EXE 전체 업데이트가 아니다. private marketplace는 현재 구현으로 표시하지 않는다.

Windows x64에서 `nuri/releases/latest`의 정식 버전만 읽는다. 같은 릴리스의 `nubi-workspace-X.Y.Z-win32-x64.vsix`와 `.sha256` 파일이 필요하다. 태그, VSIX 버전, publisher/name과 대상 플랫폼을 검사한다. 다운로드 크기, 같은 GHES 리다이렉트, 실제 SHA-256과 ZIP 내부 manifest를 대조한다. yauzl 3.4.0(MIT)의 제한된 스트림 읽기를 재사용한다. 해시 일치는 배포자 서명 검증이 아니다.

호스트가 내려받고 확인한 VSIX만 native 설치 명령에 전달한다. UI가 파일 경로나 asset ID를 정하지 않는다. 클릭 설치 요청, 재시작 필요와 실제 버전 확인을 구분하며 응답 유실 뒤 같은 설치를 자동 재전송하지 않는다. 설치 영수증에는 버전, 해시, 릴리스 ID만 저장한다. macOS/Linux에서 Windows 파일 설치를 실행하지 않는다. 배포 CI, 회사 앱 설치/승인, 릴리스 업로드는 수행하지 않았다.

## 검증과 남은 경계

주 포크의 검사와 실패 기록은 `docs/WORKSPACE-GHES-2026-10-01.md`를 따른다. 계약 검사는 합성 GHES 응답이며 UI의 사용자, SSO 승인과 버전 변화도 합성이다. 로컬 브라우저/VS Code의 실제 렌더링과 파일/프로세스는 별도로 확인한다.

`code.sdsdev.co.kr` DNS 해석 실패로 실제 SAML IdP 로그인, GitHub App 설정과 설치 범위, 저장소 복제와 사내 Release 설치는 미검증이다. Windows 제품 설치/실행과 실모델도 미검증이다. 새 설치판, 커밋과 푸시는 만들지 않았다.

## 공식 근거

- [GHES GitHub App 사용자 토큰과 Device Flow](https://docs.github.com/en/enterprise-server%403.18/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GHES의 SAML 설정과 브라우저 IdP 흐름](https://docs.github.com/en/enterprise-server%403.18/admin/managing-iam/using-saml-for-enterprise-iam/configuring-saml-single-sign-on-for-your-enterprise)
- [VS Code SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
- [VS Code Git CredentialsProvider 계약](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts)
- [VS Code의 공식 GitHub 자격 증명 연결](https://github.com/microsoft/vscode/blob/main/extensions/github/src/credentialProvider.ts)
