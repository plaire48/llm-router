import React, {useEffect, useState} from 'react';
import {Spark} from './Atmosphere.jsx';
import {AgentMark} from './AgentMark.jsx';

export function WelcomeMark({mood = 'idle', size = 160}) {
  return <div className="welcome-art" aria-hidden="true"><span className="welcome-emblem"><AgentMark size={size} mood={mood} lively/></span><Spark className="welcome-spark-one"/><Spark className="welcome-spark-two"/></div>;
}

export function AgentIntro({title = '웹을 누비는 AI Agent, 누비', description = <>작은 뱁새가 웹을 누비며<br/>탐색부터 입력과 실행까지 대신합니다.</>} = {}) {
  return <div className="agent-intro">
    <h1>{title}</h1>
    <p>{description}</p>
  </div>;
}

export function Welcome({animate, onComplete, mood = 'idle', intro, lead = '누비에게 ', greeting = `${lead}무엇을 맡길까요?`, markSize = 160}) {
  const letters = Array.from(greeting);
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    if (!animate) {onComplete(true); return;}
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer, count = 0;
    const finish = () => {clearInterval(timer); setVisible(letters.length); onComplete(true);};
    if (motion.matches) {finish(); return;}
    const change = () => {if (motion.matches) finish();};
    motion.addEventListener('change', change);
    timer = setInterval(() => {
      count++;
      setVisible(count);
      if (count === letters.length) finish();
    }, 70);
    return () => {clearInterval(timer); motion.removeEventListener('change', change);};
  }, [animate, onComplete, greeting]);

  const typing = animate && visible < letters.length;
  const text = typing ? letters.slice(0, visible).join('') : greeting;
  const Heading = intro === false ? 'h1' : 'h2';
  return <div className="welcome"><WelcomeMark mood={mood} size={markSize}/>{intro !== false && <AgentIntro {...intro}/>}<Heading className="welcome-title">
    <span className="visually-hidden">{greeting}</span>
    <span className="welcome-display" aria-hidden="true">
      <span className="welcome-reserve">{lead}<span className="welcome-accent">{greeting.slice(lead.length)}</span></span>
      <span className="welcome-typed">{text.slice(0, lead.length)}<span className="welcome-accent">{text.slice(lead.length)}</span><span className={`welcome-cursor${typing ? ' is-typing' : ''}`}/></span>
    </span>
  </Heading></div>;
}
