// UIA is the default: these actions go through the control and never move the user's mouse or keyboard.
export const CONTROL_ACTIONS=['invoke','click','set_value','select','toggle_on','toggle_off','expand','collapse','scroll','scroll_into_view'];
// Real mouse input. Each one needs its own approval with mouse consent (user decision 2026-09-30).
export const POINTER_ACTIONS=['pointer_click','pointer_double_click','pointer_right_click','hover','drag','wheel'];
// Real keyboard input into the connected window. Each one needs its own approval with keyboard consent.
export const KEYBOARD_ACTIONS=['type_text','press_keys'];
export const SCROLL_DIRECTIONS=['up','down','left','right'];
const expectations={select:['selected','True'],toggle_on:['toggle','On'],toggle_off:['toggle','Off'],expand:['expansion','Expanded'],collapse:['expansion','Collapsed']};
const member=(value,values)=>values.includes(value)?value:null;
const flag=value=>value===true||value==='True'?true:value===false||value==='False'?false:null;
// UIA reports -1 for an axis that does not scroll.
const percent=value=>{const number=typeof value==='string'&&value.trim()?Number(value):value;return Number.isFinite(number)&&number>=0&&number<=100?Math.round(number*10)/10:null;};
export function controlState(properties={}){
  const state={selected:member(properties.IsSelected,['True','False']),toggle:member(properties.ToggleState,['On','Off','Indeterminate']),expansion:member(properties.ExpandCollapseState,['Expanded','Collapsed','PartiallyExpanded','LeafNode'])};
  const scroll={vertical:percent(properties.ScrollVerticalPercent),horizontal:percent(properties.ScrollHorizontalPercent),verticallyScrollable:flag(properties.VerticallyScrollable),horizontallyScrollable:flag(properties.HorizontallyScrollable)};
  return Object.values(scroll).some(value=>value!==null)?{...state,scroll}:state;
}
export function expectedControlState(action){const entry=expectations[action];return entry?{property:entry[0],value:entry[1]}:null;}
export function supportsControlAction(target,action,direction){
  const expected=expectedControlState(action);
  if(action==='scroll'){const scroll=target.controlState?.scroll;return ['up','down'].includes(direction)?scroll?.verticallyScrollable===true:['left','right'].includes(direction)&&scroll?.horizontallyScrollable===true;}
  if(action==='scroll_into_view')return true;
  // Keys and typed text reach any control that takes focus, never a password field or a read-only one for text.
  if(action==='type_text')return target.password==='False'&&target.readOnly!=='True';
  if(action==='press_keys')return target.password==='False';
  if(!expected)return action==='set_value'||(['invoke','click'].includes(action)&&target.element.isInvokable);
  const actual=target.controlState?.[expected.property];
  return actual!=null&&actual!=='LeafNode';
}
export function checkControlState(action,target){
  const expected=expectedControlState(action),actual=expected?target.controlState?.[expected.property]:null;
  return {property:expected?.property,expected:expected?.value,actual:actual??null,verification:actual==null?'state_unavailable':actual===expected?.value?'state_matched':'state_mismatch',scope:'exact_control_state'};
}
// Whether a scroll moved the list: the scroll position of the axis before and after.
export function checkScroll(direction,before,after){
  const axis=['left','right'].includes(direction)?'horizontal':'vertical',from=before?.controlState?.scroll?.[axis]??null,to=after?.controlState?.scroll?.[axis]??null;
  return {axis,before:from,after:to,verification:from===null||to===null?'not_verified':from!==to?'scrolled':'not_scrolled',scope:'scroll_position'};
}
