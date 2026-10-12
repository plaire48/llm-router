# 사내 Windows 업데이트 배포

사용자 앱은 업데이트 버튼 한 번으로 다운로드 진행률을 확인하고 설치 후 다시 시작합니다. 업데이트 기능이 없는 이전 설치판은 이 기능이 포함된 설치판을 한 번 설치해야 합니다.

## nuri에 넣을 파일

- **Releases**: 버전별 `Nubi-Workspace-beta-1.1.2-x64-Setup.exe`
- **latest/windows-x64.json**: 현재 배포 버전을 가리키는 작은 JSON 파일

EXE를 latest 폴더에 넣거나 기존 EXE를 덮어쓰지 않습니다. 프로젝트 소스, 위키, 스킬 폴더는 변경하지 않습니다.

## 배포 순서 (사내 PC)

1. 검증된 Windows EXE와 `Publish-NubiUpdate.ps1`을 같은 폴더에 저장합니다.
2. `release-notes.txt`에 이번 변경사항을 UTF-8로 짧게 적습니다.
3. GitHub CLI에서 최초 한 번 사내 GitHub에 로그인합니다. nuri의 Contents 쓰기 권한이 필요합니다.

```powershell
gh auth login --hostname code.sdsdev.co.kr
```

4. PowerShell에서 배포합니다.

```powershell
.\Publish-NubiUpdate.ps1 -Installer .\Nubi-Workspace-beta-1.1.2-x64-Setup.exe -Version 1.1.2 -NotesFile .\release-notes.txt
```

이 스크립트는 Release에 EXE를 올리고 다시 다운로드해 SHA-256을 대조한 다음 마지막에 `latest/windows-x64.json`을 갱신합니다. 로컬에도 같은 JSON을 남깁니다. 계정/토큰을 JSON에 넣지 않습니다. 실패 시 오류 단계만 확인하고, EXE를 같은 버전의 다른 내용으로 덮어쓰지 마세요. 문제가 있는 버전의 수정은 더 높은 버전으로 배포합니다.

## JSON 구조

아래 값은 형식 설명용입니다. `assetId`, 파일 크기와 해시는 스크립트가 실제 nuri Release에서 채웁니다. GitHub.com 빌드 저장소의 assetId를 복사하면 안 됩니다.

```json
{
  "schemaVersion": 1,
  "version": "1.1.2",
  "platform": "win32",
  "arch": "x64",
  "repository": "Manufacturing-IT/nuri",
  "tag": "nubi-desktop-v1.1.2",
  "assetId": 12345,
  "filename": "Nubi-Workspace-beta-1.1.2-x64-Setup.exe",
  "size": 123456789,
  "sha256": "실제 EXE의 SHA-256 64자리",
  "notes": "메일 표와 공유 자료 화면 개선"
}
```

## 사용자 동작과 제한

- 앱의 사내 Github SSO 로그인과 nuri 읽기 권한을 사용합니다. 새 인증 프로그램은 필요하지 않습니다.
- 앱 시작 시와 매시간 확인합니다. 설정 → 업데이트 확인에서도 바로 확인할 수 있습니다.
- 새 버전이 있으면 상단에 업데이트 버튼이 표시됩니다. 클릭하면 모달에 실제 다운로드 비율, MB, 추정 남은 시간이 표시됩니다.
- 검증 후 기존 NSIS 설치기의 업데이트 모드로 자동 설치하고 재실행합니다. 진행 중인 에이전트/위키/메일 처리, 열린 터미널 또는 미저장 파일이 있으면 설치를 보류합니다. 다운로드는 유지합니다.
- 설치 중의 %를 다운로드 %로 꾸며 표시하지 않습니다. 검증 이후 모달은 설치와 재시작 안내를 표시하고, 앱이 종료된 동안 기존 설치기가 교체합니다.
- SHA-256 검증은 전송 파일의 무결성 확인입니다. 공인 코드 서명을 대신하지 않습니다. 현재 Beta 서명/보안 경고의 한계는 별도입니다.
- 사내 GitHub가 Release 파일을 외부 호스트로 리다이렉트하도록 구성되었다면 다운로드는 중단됩니다. 임의 호스트에 인증값을 보내지 않으며, 실제 사내 배포에서 경로 확인이 필요합니다.

## 구현 근거와 검증 경계

GHES [Release asset API](https://docs.github.com/en/enterprise-server@3.17/rest/releases/assets#get-a-release-asset)의 octet-stream과 200/302 계약, 번들 electron-builder의 NSIS `--updated`, `--force-run`, `/S` 실행 방식을 사용합니다. 기존 사내 GitHub 계정과 고정 저장소 경계를 재사용하려고 별도 전역 토큰을 요구하는 업데이트 제공자를 도입하지 않았습니다.

사내 배포는 사내 PC에서만 가능하므로 이 Mac의 로컬 검사/GitHub Windows 검사와 실제 nuri 업로드·사내 PC 업데이트 성공을 구분합니다.
