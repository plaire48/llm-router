import {useEffect} from 'react';

// CX 0.5.4 closes its panel on backdrop mousedown and has no public opt-out.
// Keep its focus/keyboard lifecycle; block only Desktop's backdrop gesture.
export function useModalDismissalPolicy() {
 useEffect(()=>{
  const keepOpen=event=>{
   const backdrop=event.target;
   if(!(backdrop instanceof Element)||!backdrop.matches('.cx-panel-backdrop')||!document.querySelector('.desktop-shell'))return;
   if(!backdrop.querySelector(':scope > .deck-dialog[aria-modal="true"]'))return;
   event.preventDefault();
   event.stopImmediatePropagation();
  };
  const events=['pointerdown','mousedown','click'];
  for(const type of events)document.addEventListener(type,keepOpen,true);
  return()=>{for(const type of events)document.removeEventListener(type,keepOpen,true);};
 },[]);
}
