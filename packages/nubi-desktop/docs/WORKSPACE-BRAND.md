# 누비 workspace

제품명은 **누비 workspace**, 사용자 표시 버전은 **beta 1.1.1**이다. 릴리즈 제목과 카탈로그는 **누비 workspace beta 1.1.1**으로 표시한다. Windows 제품명과 바로가기는 **누비 workspace**, 창 제목과 제거 항목은 버전을 포함한다. 패키지와 Windows 메타데이터의 숫자 버전은 **1.1.1**이며 GitHub에는 사전 배포로 게시한다.

기존 누비 새 이미지, 누비 beta 워드마크와 모션, HTML 기준 글꼴과 색상을 재사용한다. 로고에 별도의 Workspace 문구는 붙이지 않는다. Windows 설치 아이콘도 승인된 bird-master.png를 사용한다. 브라우저와 Office의 독립 배포 버전은 변경하지 않는다.

이전 설치와의 연결을 위해 내부 nubi-desktop 패키지, nubi.workspace 앱 ID와 Nubi Workspace.exe 실행 파일, 저장 경로는 유지한다. 배포 파일은 Nubi-Workspace-beta-1.1.1-x64-Setup.exe다. 기존 electron-builder NSIS의 이름 변경과 업그레이드 기능을 재사용하며 새 의존성을 추가하지 않는다.

릴리즈 이름만 바꾸지 않고 실제 패키지 버전과 Windows 메타데이터를 함께 검증한다. 이전 설치에서 업그레이드한 뒤 바로가기 이름과 아이콘, 설치된 앱의 버전을 확인한다. 자세한 검증 경계는 WINDOWS-RELEASE.md를 따른다.
