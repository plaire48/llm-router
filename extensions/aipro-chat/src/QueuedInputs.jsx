import React, {useLayoutEffect, useRef, useState} from 'react';
import {CxButton} from '@e2e/cx-design-system';
import {DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors} from '@dnd-kit/core';
import {SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';

function QueuedInput({item, disabled, children}) {
  const {attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging} = useSortable({id:item.id, disabled});
  return <li ref={setNodeRef} data-dragging={isDragging || undefined} style={{transform:CSS.Transform.toString(transform), transition:transition ? 'transform var(--cx-motion) var(--deck-ease)' : undefined}}>
    <CxButton ref={setActivatorNodeRef} {...attributes} {...listeners} className="composer-icon agent-input-handle" disabled={disabled} aria-label="대기 메시지 순서 변경" title="드래그하여 순서 변경" aria-roledescription="순서 변경 손잡이">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{[8,16].flatMap(x => [6,12,18].map(y => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5"/>))}</svg>
    </CxButton>
    {children}
  </li>;
}

export function QueuedInputs({items, busy, onReorder, children, hideSteering = false}) {
  const visibleItems = hideSteering ? items.filter(item => item.mode !== 'steer') : items;
  const order = useRef([]);
  const list = useRef(null);
  const [maxHeight, setMaxHeight] = useState();
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const rows = [...node.children].slice(0, 3);
    const measure = () => {
      const style = getComputedStyle(node);
      const height = rows.reduce((total, row) => total + row.getBoundingClientRect().height, 0)
        + Math.max(0, rows.length - 1) * parseFloat(style.rowGap)
        + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      setMaxHeight(`${Math.ceil(height)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    rows.forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [items]);
  const sensors = useSensors(useSensor(PointerSensor, {activationConstraint:{distance:6}}), useSensor(KeyboardSensor, {coordinateGetter:sortableKeyboardCoordinates, scrollBehavior:'auto'}));
  const accessibility = {
    screenReaderInstructions:{draggable:'스페이스로 잡고 위아래 방향키로 옮기세요. 다시 스페이스로 놓고 Escape로 취소합니다.'},
    announcements:{onDragStart:()=> '메시지를 잡았습니다.', onDragOver:({over})=>over ? `${visibleItems.findIndex(item=>item.id===over.id)+1}번째 위치` : '대기열 밖', onDragEnd:()=> '드래그를 마쳤습니다.', onDragCancel:()=> '순서 변경을 취소했습니다.'},
  };
  return <DndContext sensors={sensors} collisionDetection={args=>closestCenter({...args,droppableContainers:args.droppableContainers.filter(container=>{
    const moving=items.find(item=>item.id===args.active.id), target=items.find(item=>item.id===container.id);
    return target?.mode==='queue' && moving?.runId===target.runId;
  })})} accessibility={accessibility} onDragStart={()=>{order.current=items.map(item=>item.id);}} onDragEnd={({active,over})=>{if(over && active.id!==over.id) onReorder({id:active.id,overId:over.id,order:order.current});}}>
    <SortableContext items={visibleItems.map(item=>item.id)} strategy={verticalListSortingStrategy}>
      <ul ref={list} style={{maxHeight}} className="agent-input-queue" aria-label="대기 메시지" aria-live="polite">
        {visibleItems.map((item,index)=><QueuedInput key={item.id} item={item} disabled={busy || item.mode!=='queue' || items.filter(other=>other.runId===item.runId && other.mode==='queue').length<2}>{children(item,index)}</QueuedInput>)}
      </ul>
    </SortableContext>
  </DndContext>;
}
