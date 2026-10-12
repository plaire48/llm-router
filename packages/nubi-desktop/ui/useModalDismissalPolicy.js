import {useEffect} from 'react';

// Keep CX's modal focus/keyboard lifecycle and close guards. The original
// trigger is the only interactive spot through the otherwise inert backdrop.
export function useModalDismissalPolicy() {
 useEffect(()=>{
  const triggers=new WeakMap();let lastActivation=null,frame=0;
  const dialogs=()=>[...document.querySelectorAll('[aria-modal="true"]')].filter(node=>node.getClientRects().length&&!node.closest('[inert],[hidden]'));
  const register=()=>{
   if(!lastActivation||performance.now()-lastActivation.at>1000)return;
   const trigger=lastActivation.node;
   if(!trigger.isConnected)return;
   for(const dialog of dialogs())if(!triggers.has(dialog)&&!dialog.contains(trigger))triggers.set(dialog,trigger);
  };
  // Portals are direct body children. Never observe every streaming text change.
  const changes=new MutationObserver(register);changes.observe(document.body,{childList:true});
  const containsPoint=(node,event)=>{const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom;};
  const handle=event=>{
   if(!(event.target instanceof Element)||!document.querySelector('.desktop-shell'))return;
   const dialog=dialogs().at(-1),trigger=dialog&&triggers.get(dialog);
   const pointer=event.type!=='click'||event.detail>0;
   if(dialog&&trigger?.isConnected&&pointer&&event.button===0&&!dialog.contains(event.target)&&!containsPoint(dialog,event)&&containsPoint(trigger,event)){
    event.preventDefault();event.stopImmediatePropagation();
    if(event.type==='click'){
     // Use the real close action; disabled/busy dialogs and custom recovery
     // handlers keep exactly the same behavior as clicking their X.
     const close=dialog.querySelector(':scope > .cx-panel-header .cx-action-button[data-action="close"], .nubi-modal-close, .nubi-skill-menu-close');
     if(close&&!close.disabled&&dialog.getAttribute('aria-busy')!=='true'){
      close.click();requestAnimationFrame(()=>{if(!dialog.isConnected&&trigger.isConnected&&!trigger.closest('[inert]'))trigger.focus({preventScroll:true});});
     }
    }
    return;
   }
   const backdrop=event.target;
   if(backdrop.matches('.cx-panel-backdrop')&&backdrop.querySelector(':scope > .deck-dialog[aria-modal="true"]')){
    event.preventDefault();event.stopImmediatePropagation();return;
   }
   if(event.type==='click'){
    const button=event.target.closest('button,[role="button"]');
    if(button&&!button.disabled){lastActivation={node:button,at:performance.now()};cancelAnimationFrame(frame);frame=requestAnimationFrame(register);}
   }
  };
  const events=['pointerdown','mousedown','pointerup','mouseup','click'];
  for(const type of events)document.addEventListener(type,handle,true);
  return()=>{changes.disconnect();cancelAnimationFrame(frame);for(const type of events)document.removeEventListener(type,handle,true);};
 },[]);
}
