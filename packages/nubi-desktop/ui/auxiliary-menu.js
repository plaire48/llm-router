export function auxiliaryMenu(view) {
  if(['files','file','browser','terminal','document','commands','repositories','search'].includes(view))return 'files';
  if(['changes','history','diff'].includes(view))return 'changes';
  return view;
}
