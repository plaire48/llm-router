import React, {useEffect, useRef} from 'react';
import {Icon} from '@e2e/cx-design-system';
import {HELP_SECTIONS} from '../help-content.js';
import {DeckSectionLabel} from './DeckSurfaces.jsx';

export function HelpContent({sections=HELP_SECTIONS}) {
  const first = useRef(null);
  useEffect(() => {first.current?.focus({preventScroll: true});}, []);
  return <div className="help-topics">
    {sections.map((section, index) => <details className="help-topic" name="nubi-help" key={section.id}>
      <summary ref={index === 0 ? first : undefined}><DeckSectionLabel icon={section.icon} tone={['blue','violet','teal'][index % 3]}>{section.title}</DeckSectionLabel><Icon name="chevronDown" size={16}/></summary>
      <div className="help-topic-body">
        {section.lead && <p className="help-lead"><strong>{section.lead}</strong></p>}
        {section.controls && <dl className="help-controls">{section.controls.map(control => <div key={control.label}><Icon name={control.icon} size={18}/><div><dt>{control.label}</dt><dd>{control.description}</dd></div></div>)}</dl>}
        {section.paragraphs?.map(text => <p key={text}>{text}</p>)}
        {section.points && <dl className="help-points">{section.points.map(point => <div key={point.title}><dt><strong>{point.title}</strong></dt><dd>{point.detail}</dd></div>)}</dl>}
        {section.examples && <div className="help-examples" aria-label="요청 예시">{section.examples.map(example => <blockquote key={example}>{example}</blockquote>)}</div>}
        {section.questions && <dl className="help-questions">{section.questions.map(item => <div key={item.title}><dt>{item.title}</dt><dd>{item.answer}</dd></div>)}</dl>}
      </div>
    </details>)}
  </div>;
}
