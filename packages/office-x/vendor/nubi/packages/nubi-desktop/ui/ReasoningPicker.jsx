import {createPortal} from 'react-dom';
import {pickerWidth} from './picker-width.mjs';
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {useAnchoredModal} from './useAnchoredModal.js';

const OPTIONS = {
  aipro: [{id:'low', label:'Low'}, {id:'medium', label:'Medium'}, {id:'xhigh', label:'Extra high'}],
  chatgpt: [{id:'low', label:'Light'}, {id:'medium', label:'Medium'}, {id:'high', label:'High'}, {id:'xhigh', label:'Extra high'}, {id:'max', label:'Ultra'}],
  claude: [{id:'low',label:'Low'}, {id:'medium',label:'Medium'}, {id:'high',label:'High'}, {id:'xhigh',label:'Xhigh'}, {id:'max',label:'Max'}]
};
const DEFAULTS = {aipro:'medium', chatgpt:'medium', claude:'medium'};
const ADJUST_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

function readStored(provider) {
  if (provider === 'claude') return DEFAULTS.claude;
  try { const stored = localStorage.getItem(`nubi-reasoning:${provider}`), value = provider === 'chatgpt' && stored === 'ultra' ? 'max' : stored; return OPTIONS[provider]?.some(item => item.id === value) ? value : DEFAULTS[provider]; } catch { return DEFAULTS[provider]; }
}

export function ReasoningPicker({api, provider, disabled}) {
  const claude=provider?.provider==='claude';
  const optional = provider?.provider === 'chatgpt' && provider?.connected ? [{id:'none',label:'None'},{id:'minimal',label:'Minimal'}].filter(item=>provider.reasoningOptions?.includes(item.id)) : [];
  const options = claude
    ? (provider.reasoningOptions || []).map(id => OPTIONS.claude.find(item => item.id === id)).filter(Boolean)
    : [...optional, ...(OPTIONS[provider?.provider] || []).filter(item => !provider?.connected || !Array.isArray(provider.reasoningOptions) || provider.reasoningOptions.includes(item.id))];
  const [open, setOpen] = useState(false), [changing, setChanging] = useState(false), [effort, setEffort] = useState(() => provider?.reasoningEffort === 'ultra' ? 'max' : provider?.reasoningEffort || readStored(provider?.provider));
  const [menuStyle, setMenuStyle] = useState(undefined);
  const anchor = useRef(null), dialog = useRef(null), trigger = useRef(null), pending = useRef(false), currentSelection = useRef(null), mounted = useRef(true);
  const confirmed = useRef(effort), gesture = useRef(null);
  currentSelection.current = JSON.stringify([provider?.provider,provider?.model]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const value = provider?.reasoningEffort === 'ultra' ? 'max' : provider?.reasoningEffort || readStored(provider?.provider);
    confirmed.current = value;
    gesture.current = null;
    setEffort(value);
  }, [provider?.provider, provider?.model, provider?.reasoningEffort]);
  useEffect(()=>{setOpen(false);},[provider?.provider,provider?.model]);
  useAnchoredModal(dialog, trigger, open, 'input[type="range"]', true);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const node = anchor.current, content = node.closest('.nubi-workbench-content');
    const place = () => {
      const rect = node.getBoundingClientRect();
      const start = 16, end = innerWidth - 16;
      const width = pickerWidth(end - start);
      const left = Math.max(start, Math.min(rect.left, end - width));
      const height=Math.min(dialog.current?.scrollHeight||160,innerHeight-32),above=rect.top-height-8;
      const next={position:'fixed',width,left,top:Math.max(16,Math.min(above>=16?above:rect.bottom+8,innerHeight-height-16)),bottom:'auto',maxHeight:innerHeight-32,overflowY:'auto',zIndex:1200};
      setMenuStyle(previous=>previous&&Object.keys(next).every(key=>previous[key]===next[key])?previous:next);
    };
    place();
    const sizes = new ResizeObserver(place);
    sizes.observe(node); if (content) sizes.observe(content); if(dialog.current)sizes.observe(dialog.current);
    window.addEventListener('resize', place);document.addEventListener('scroll',place,true);
    return () => {sizes.disconnect(); window.removeEventListener('resize', place);document.removeEventListener('scroll',place,true);};
  }, [open]);
  if (!options.length) return null;
  const selected = options.find(item => item.id === effort) || options[0];
  const selectedIndex = Math.max(0, options.findIndex(item => item.id === selected.id));
  function cancelGesture() {
    if (!gesture.current) return;
    gesture.current = null;
    setEffort(confirmed.current);
  }
  function finishGesture(event) {
    if (!gesture.current) return;
    gesture.current = null;
    choose(options[Number(event.currentTarget.value)]);
  }
  async function choose(item) {
    if (!item || pending.current || disabled) return;
    if (item.id === confirmed.current) { setEffort(item.id); return; }
    const providerId = provider.provider, previous = confirmed.current, selection = currentSelection.current;
    pending.current = true; setChanging(true);
    setEffort(item.id);
    try {
      const result = await api('provider', {action:'reasoning', input:{effort:item.id,expectedProvider:providerId,expectedModel:provider.model}});
      if (result?.reasoningEffort !== item.id) throw Error('reasoning_not_applied');
      if (!mounted.current || currentSelection.current !== selection) return;
      confirmed.current = item.id;
      if (providerId !== 'claude') try { localStorage.setItem(`nubi-reasoning:${providerId}`, item.id); } catch {}
    } catch (error) {
      if (!mounted.current || currentSelection.current !== selection) return;
      setEffort(previous);
      notifyWorkspaceToast(error.message==='reasoning_changed'?'모델이 바뀌었어요. 현재 모델에서 다시 선택해 주세요.':provider?.connected ? '추론 정도를 적용하지 못했습니다. 연결을 확인하고 다시 선택해 주세요.' : '모델을 연결한 뒤 추론 정도를 선택해 주세요.', {error: true});
    } finally { pending.current = false; if (mounted.current) setChanging(false); }
  }
  return <div className="nubi-reasoning-anchor" data-provider={provider?.provider} ref={anchor} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); cancelGesture(); setOpen(false); anchor.current?.querySelector('.nubi-reasoning-trigger')?.focus(); } }}>
    <CxButton ref={trigger} className="nubi-reasoning-trigger" aria-label="추론 정도" title={claude?`Claude 추론 요청: --effort ${selected.id}`:`추론 정도: ${selected.label}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled||changing} onClick={() => setOpen(value => !value)}><Icon name="automation" size={18}/><span className="nubi-reasoning-label"><span>{selected.label}</span></span></CxButton>
    {open && createPortal(<div ref={dialog} className="nubi-reasoning-menu" data-provider={provider?.provider} style={menuStyle} role="dialog" aria-modal="true" aria-label="추론 정도 조절" aria-busy={changing}>
      <div className="nubi-reasoning-heading"><strong>{selected.label}</strong><CxButton className="nubi-reasoning-reset" data-icon-only aria-label="추론 정도를 기본값으로 되돌리기" title="기본값으로 되돌리기" disabled={disabled||changing} onClick={() => choose(options.find(item => item.id === DEFAULTS[provider.provider]) || options[0])}><Icon name="resetFilters" size={18}/></CxButton><CxButton className="nubi-reasoning-close nubi-modal-close" data-icon-only aria-label="추론 창 닫기" title="닫기" disabled={changing} onClick={()=>{cancelGesture();setOpen(false);anchor.current?.querySelector('.nubi-reasoning-trigger')?.focus();}}><Icon name="xClose" size={18}/></CxButton></div>
      <div className="nubi-reasoning-slider-wrap" style={{'--nubi-reasoning-progress':`${selectedIndex / Math.max(1, options.length - 1) * 100}%`}}>
        <input className="nubi-reasoning-slider" type="range" min="0" max={options.length - 1} step="1" value={selectedIndex} disabled={disabled||changing} aria-label="추론 정도" aria-valuetext={selected.label}
          onPointerDown={event => { if (event.button === 0) { gesture.current = 'pointer'; event.currentTarget.setPointerCapture(event.pointerId); } }}
          onPointerUp={finishGesture} onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture}
          onKeyDown={event => { if (ADJUST_KEYS.has(event.key)) gesture.current = 'keyboard'; }}
          onKeyUp={event => { if (ADJUST_KEYS.has(event.key)) finishGesture(event); }}
          onBlur={event => { if (gesture.current === 'keyboard') finishGesture(event); }}
          onChange={event => { const item = options[Number(event.target.value)]; if (!item) return; setEffort(item.id); if (!gesture.current) choose(item); }}/>
        <div className="nubi-reasoning-ticks" aria-hidden="true">{options.map((item,index) => <span key={item.id} data-filled={index < selectedIndex} className={item.id === selected.id ? 'is-selected' : ''}/>)}</div>
      </div>
    </div>,document.body)}
  </div>;
}
