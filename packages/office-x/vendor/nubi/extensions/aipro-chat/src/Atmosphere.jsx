import React, {useEffect, useState} from 'react';

export function useMotionPreference() {
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPaused(preference.matches);
    const visibility = () => {document.documentElement.dataset.motionVisibility = document.hidden ? 'hidden' : 'visible';};
    // The removed toolbar toggle must not leave an invisible paused preference.
    try {localStorage.removeItem('aipro:motion-paused');} catch { /* OS preference remains available. */ }
    sync(); visibility(); preference.addEventListener('change', sync); document.addEventListener('visibilitychange', visibility);
    return () => {preference.removeEventListener('change', sync); document.removeEventListener('visibilitychange', visibility);};
  }, []);
  useEffect(() => {document.documentElement.dataset.motion = paused ? 'paused' : 'running';}, [paused]);
  return {paused};
}

export function useIdleExpression(active) {
  const [sleeping, setSleeping] = useState(false);
  useEffect(() => {
    setSleeping(false);
    if (active) return;
    let timer, lastMove = 0;
    const wake = () => {setSleeping(false); clearTimeout(timer); timer = setTimeout(() => setSleeping(true), 20000);};
    const move = () => {if (Date.now() - lastMove > 1000) {lastMove = Date.now(); wake();}};
    wake();
    window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake); window.addEventListener('pointermove', move, {passive: true});
    document.addEventListener('visibilitychange', wake);
    return () => {clearTimeout(timer); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); window.removeEventListener('pointermove', move); document.removeEventListener('visibilitychange', wake);};
  }, [active]);
  return sleeping ? 'sleep' : 'idle';
}

export function Spark({className = ''}) {
  return <svg className={`deck-spark ${className}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1c.7 6.8 4.2 10.3 11 11-6.8.7-10.3 4.2-11 11C11.3 16.2 7.8 12.7 1 12c6.8-.7 10.3-4.2 11-11Z"/></svg>;
}

export function AmbientScene() {
  return <div className="deck-ambient" aria-hidden="true"><i className="deck-blob deck-blob-blue"/><i className="deck-blob deck-blob-violet"/><i className="deck-blob deck-blob-teal"/><Spark className="ambient-spark-one"/><Spark className="ambient-spark-two"/></div>;
}
