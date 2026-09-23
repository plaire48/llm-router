// UIA is the default. Shared-pointer gestures require separate per-action human consent.
export const CONTROL_ACTIONS=['invoke','click','set_value','select','toggle_on','toggle_off','expand','collapse'];
export const POINTER_ACTIONS=['pointer_click','pointer_double_click','pointer_right_click','hover','drag'];
const expectations={select:['selected','True'],toggle_on:['toggle','On'],toggle_off:['toggle','Off'],expand:['expansion','Expanded'],collapse:['expansion','Collapsed']};
const member=(value,values)=>values.includes(value)?value:null;
export function controlState(properties={}){
  return {selected:member(properties.IsSelected,['True','False']),toggle:member(properties.ToggleState,['On','Off','Indeterminate']),expansion:member(properties.ExpandCollapseState,['Expanded','Collapsed','PartiallyExpanded','LeafNode'])};
}
export function expectedControlState(action){const entry=expectations[action];return entry?{property:entry[0],value:entry[1]}:null;}
export function supportsControlAction(target,action){
  const expected=expectedControlState(action);
  if(!expected)return action==='set_value'||(['invoke','click'].includes(action)&&target.element.isInvokable);
  const actual=target.controlState?.[expected.property];
  return actual!=null&&actual!=='LeafNode';
}
export function checkControlState(action,target){
  const expected=expectedControlState(action),actual=expected?target.controlState?.[expected.property]:null;
  return {property:expected?.property,expected:expected?.value,actual:actual??null,verification:actual==null?'state_unavailable':actual===expected?.value?'state_matched':'state_mismatch',scope:'exact_control_state'};
}
