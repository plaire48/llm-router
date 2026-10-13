$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
 & node scripts/prepare-companion.mjs
 if($LASTEXITCODE){throw 'Companion source preparation failed'}
 & node scripts/build-companion-glue.mjs
 if($LASTEXITCODE){throw 'Companion Nubi adapter build failed'}
 & dotnet build native/OfficeX.AccountBridge -c Release
 if($LASTEXITCODE){throw 'Shared Office account bridge build failed'}
 Copy-Item native/OfficeX.AccountBridge/bin/Release/net472/* dist/companion -Force
 Push-Location companion/workspace
 try {
  & npm ci --ignore-scripts --no-audit
  if($LASTEXITCODE){throw 'Original GenOffice dependency restore failed'}
  & node node_modules/electron/install.js
  if($LASTEXITCODE){throw 'Companion Electron download failed'}
  & rustup target add x86_64-pc-windows-msvc
  if($LASTEXITCODE){throw 'Companion Rust target setup failed'}
  & cargo build --release --target x86_64-pc-windows-msvc --manifest-path apps/sheets/native/xlsx-engine/Cargo.toml --config apps/sheets/native/xlsx-engine/.cargo/config.toml --locked
  if($LASTEXITCODE){throw 'Original XLSX engine build failed'}
  $env:GENOFFICE_APP_VERSION=(Get-Content "$root/package.json" -Raw|ConvertFrom-Json).version
  & npm run build:all
  if($LASTEXITCODE){throw 'Original editor build failed'}
  Copy-Item "$root/dist/companion/auth-bird.png" apps/shell/out/main -Force
  Copy-Item "$root/dist/companion/auth-fonts.css" apps/shell/out/main -Force
  & npm run notices
  if($LASTEXITCODE){throw 'Companion license inventory failed'}
  $env:CSC_IDENTITY_AUTO_DISCOVERY='false'
  Push-Location apps/shell
  try {
   & npx electron-builder --win --x64 --dir --publish never
   if($LASTEXITCODE){throw 'Companion Windows package failed'}
   $resources=Join-Path (Get-Location) 'release/win-unpacked/resources'
   Copy-Item "$root/dist/companion" "$resources/nubi" -Recurse -Force
   Copy-Item "$root/companion/adaptations.json" "$resources/nubi" -Force
  }finally{Pop-Location}
 }finally{Pop-Location}
 $exe=Get-Item companion/workspace/apps/shell/release/win-unpacked/'Nubi GenOffice.exe'
 $modules=@('docs','sheets','slides','pdf','markdown','html')
 foreach($module in $modules){if(!(Test-Path "companion/workspace/apps/shell/release/win-unpacked/resources/modules/$module/renderer/index.html")){throw "Missing editor: $module"}}
 @{version=$env:GENOFFICE_APP_VERSION;exe=$exe.Name;sha256=(Get-FileHash $exe).Hash;editors=$modules;sharedOfficeVault=$true;liveModelsVerified=$false}|ConvertTo-Json -Depth 5|Set-Content verification/companion-build.json
}finally{Pop-Location}
