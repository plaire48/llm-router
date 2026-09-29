import {inspectTarget} from './generated/browser-dom.js';

// Playwright press/type do not check actionability or prove that focus stayed
// on the requested node. Keep that proof separate from issuing actual keys.
async function inspect(handle, original, {focused = false, typing = false} = {}) {
  const state = await handle.evaluate(inspectTarget);
  if (!state.connected || original && (state.type !== original.type || state.name !== original.name)) throw new Error('browser_stale');
  if (state.secret) throw new Error('script_secret_field');
  if (state.hidden) throw new Error('script_hidden');
  if (state.disabled) throw new Error('script_disabled');
  if (typing && !state.editable) throw new Error('script_target');
  if (focused && !state.focused) throw new Error('script_focus');
  return state;
}

export async function keyboardInput(handle, page, method, value, options = {}, {cancelled = () => false, onIssued = () => {}, beforeIssued} = {}) {
  const typing = method === 'pressSequentially';
  // Sequential text is a short widget interaction, never a hidden Enter/Tab
  // submission or a replacement for efficient large-body fill/appendText.
  if (typeof value !== 'string' || !value || value.length > (typing ? 512 : 100) || /[\u0000-\u001f\u007f]/.test(value) ||
    typing && options.delay !== undefined && (!Number.isFinite(options.delay) || options.delay < 0 || options.delay > 50)) throw new Error('script_invalid');
  const checkCancelled = () => {if (cancelled()) throw new Error('cancelled');};
  checkCancelled();
  const original = await inspect(handle, null, {typing});
  await handle.focus();
  const parts = typing ? [...value] : [value];
  for (const part of parts) {
    checkCancelled();
    await inspect(handle, original, {typing, focused: true});
    checkCancelled();
    if (beforeIssued) {
      await beforeIssued();
      checkCancelled();
      await inspect(handle, original, {typing, focused:true});
      checkCancelled();
    }
    onIssued();
    if (typing) await page.keyboard.type(part);
    else await page.keyboard.press(part);
    if (typing && options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
  }
  // A partial prefix is not replayed on failure. The caller returns receipts
  // plus a fresh observation for the next model decision.
}
