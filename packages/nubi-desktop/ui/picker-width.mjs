// Read the shared CX size in rem so larger system text gets a wider picker.
export function pickerWidth(available=window.innerWidth-24) {
  const root=getComputedStyle(document.documentElement),token=root.getPropertyValue('--nubi-picker-width').trim()||'24rem';
  const width=parseFloat(token)*(token.endsWith('rem')?(parseFloat(root.fontSize)||16):1);
  return Math.min(width,Math.max(0,available));
}
