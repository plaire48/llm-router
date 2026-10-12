"""Copy selected current Nubi source and its relative module closure, preserving bytes."""
import pathlib,re,hashlib,json,subprocess,shutil
src=pathlib.Path('/Users/ganadi/Documents/llm_router'); dst=pathlib.Path('vendor/nubi')
seeds=['packages/nubi-desktop/runtime/desktop-providers.mjs','packages/nubi-office/worker/providers.mjs','packages/nubi-desktop/runtime/chatgpt-catalog.mjs','packages/nubi-desktop/ui/provider-login-state.mjs','packages/nubi-desktop/ui/ResponseTime.jsx','packages/nubi-desktop/ui/useConversationScroll.js','extensions/aipro-chat/src/NubiSurfaces.jsx','extensions/aipro-chat/src/ChatControls.jsx']
seen=set()
def copy(rel):
 p=(src/rel).resolve(); rel=str(p.relative_to(src))
 if rel.endswith('/agent-runtime.js'):return
 if rel in seen:return
 seen.add(rel);data=p.read_bytes();target=dst/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 if p.suffix in ['.js','.jsx','.mjs']:
  for dep in re.findall(r'(?:from\s*|import\s*)[\'\"]([^\'\"]+)[\'\"]',data.decode()):
   if dep.startswith('.'):copy(str((p.parent/dep).relative_to(src)))
seeds += ['extensions/aipro-chat/src/app.css', 'packages/nubi-desktop/design/workspace-identity.css', 'packages/nubi-desktop/electron-app/ios-tokens.css', 'packages/nubi-desktop/design/workspace-typography.css', 'packages/nubi-desktop/design/workspace-density.css', 'packages/nubi-desktop/design/workspace-dialogs.css']
seeds += ['packages/nubi-desktop/ui/ReasoningPicker.jsx']
for rel in seeds:copy(rel)
copy('extensions/aipro-chat/public/icons/agent-128.png')
copy('extensions/aipro-chat/design/agent-deck.css')
copy('packages/openwiki/src/auth/aipro-callback-fonts.css')
for name in ['agent-bird','agent-blink','agent-wing','agent-smile','agent-sad','nubi-wordmark'] :copy('extensions/aipro-chat/public/icons/'+name+'.webp')
for name in ['aipro','openai','fabrix','claude']:copy('extensions/aipro-chat/public/icons/'+name+'.svg')
copy('extensions/aipro-chat/vendor/e2e-cx-design-system-0.5.4.tgz')
manifest={'source':str(src),'observedHead':subprocess.check_output(['git','-C',str(src),'rev-parse','HEAD'],text=True).strip(),'note':'Selected working-tree files; no credentials or user state copied. Nubi local source is not relicensed by Office X.','files':[{'path':r,'sha256':hashlib.sha256((dst/r).read_bytes()).hexdigest()} for r in sorted(seen)]}
manifest['adaptations']=[{'source':'extensions/aipro-chat/agent-runtime.js','sourceSha256':hashlib.sha256((src/'extensions/aipro-chat/agent-runtime.js').read_bytes()).hexdigest(),'path':'runtime-src/nubi-wire.mjs','sha256':hashlib.sha256(pathlib.Path('runtime-src/nubi-wire.mjs').read_bytes()).hexdigest(),'note':'Only emptyUsage, textContent, parseArgs, assistant and toPi wire conversion extracted. Agent engine is excluded by the build alias.'}]
pathlib.Path('vendor/nubi-workspace-source.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Copied',len(seen),'source files')
