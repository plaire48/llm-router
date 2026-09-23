import React, {useEffect, useRef, useState} from 'react';

export function NubiWordmark() {
  return <img className="nubi-wordmark" src="./icons/nubi-wordmark.webp" alt="누비" width="42" height="24" draggable="false"/>;
}

export function NubiLogo({mood = 'idle', product}) {
  return <span className="nubi-logo"><AgentMark size={32} mood={mood} lively/><NubiWordmark/>{product&&<span className="nubi-logo-product">{product}</span>}<span className="nubi-beta">beta</span></span>;
}

// The mascot identifies the agent. Provider buttons keep their own logos.
export function AgentMark({size = 28, className = '', mood = 'still', lively = false}) {
  const previous = useRef(mood), [celebrating, setCelebrating] = useState(false);
  const [greeting, setGreeting] = useState(false);
  useEffect(() => {
    if (!greeting) return;
    const timer = setTimeout(() => setGreeting(false), 1800);
    return () => clearTimeout(timer);
  }, [greeting]);
  useEffect(() => {
    let timer;
    if (previous.current === 'working' && mood === 'done') {
      setCelebrating(true); timer = setTimeout(() => setCelebrating(false), 4200);
    } else setCelebrating(false);
    previous.current = mood;
    return () => clearTimeout(timer);
  }, [mood]);
  const state = ['sad', 'error'].includes(mood) ? 'sad' : mood === 'working' ? 'working' : celebrating || greeting ? 'celebrate' : mood === 'sleep' ? 'sleep' : mood === 'idle' || lively ? 'idle' : 'still';
  return <span className={`agent-mark ${className}`} data-mood={state} aria-hidden="true" style={{'--agent-size': `${size}px`}} onPointerEnter={() => {if (lively && ['idle', 'done', 'sleep'].includes(mood)) setGreeting(true);}} onPointerLeave={() => setGreeting(false)}>
    <img className="bird-base" src="./icons/agent-bird.webp" alt="" width={size} height={size} draggable="false"/>
    {['blink', 'wing', 'smile', 'sad'].map(frame => <img className={`bird-frame bird-${frame}`} key={frame} src={`./icons/agent-${frame}.webp`} alt="" width={size} height={size} draggable="false"/>)}
    <svg className="bird-dream" viewBox="0 0 1280 1280" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round"><path className="bird-z bird-z-one" d="M800 170h110l-110 95h110"/><path className="bird-z bird-z-two" d="M985 35h130l-130 112h130"/></svg>
    <span className="bird-tear bird-tear-left"/><span className="bird-tear bird-tear-right"/>
    <svg className="bird-joy" viewBox="0 0 1280 1280" fill="currentColor"><path d="M1040 80q8 66 65 70q-57 8-65 70q-8-62-65-70q57-4 65-70Z"/><path d="M1180 260q6 38 36 42q-30 6-36 42q-6-36-36-42q30-4 36-42Z"/></svg>
  </span>;
}
