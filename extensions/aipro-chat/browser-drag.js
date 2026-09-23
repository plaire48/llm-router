// Native browser input only. The host resolves and guards both observed nodes.
// A returned drag is a receipt, never proof that the site accepted the drop.
export async function dragObserved(task, source, destination, {present, cancelled, onIssued}) {
  if (source.frame !== destination.frame) throw new Error('drag_cross_frame');
  const check = () => {if (cancelled()) throw new Error('cancelled');};
  check();
  // Playwright performs normal visibility/stability/hit-target checks. No force,
  // synthetic DragEvent, arbitrary code, random trajectories or fixed sleeps.
  await source.handle.hover({trial: true, timeout: 7000}); check();
  await destination.handle.hover({trial: true, timeout: 7000}); check();
  return present(async () => {
    let pressed = false;
    const release = task.releaseDrag = async () => {
      if (!pressed) return;
      pressed = false;
      await task.page.keyboard.press('Escape').catch(() => {});
      await task.page.mouse.up().catch(() => {});
    };
    try {
      await source.handle.hover({timeout: 7000}); check();
      onIssued(); pressed = true;
      await task.page.mouse.down(); check();
      await destination.handle.hover({timeout: 7000}); check();
      // Native HTML dragover requires a second move on some browsers.
      await destination.handle.hover({timeout: 7000}); check();
      await task.page.mouse.up(); pressed = false; check();
      return {ok: true, actionIssued: true, verified: false};
    } finally {
      // Release input even when a target disappears, cancellation occurs or
      // the page rejects the drop. Never automatically replay the drag.
      await release();
      if (task.releaseDrag === release) delete task.releaseDrag;
    }
  });
}
