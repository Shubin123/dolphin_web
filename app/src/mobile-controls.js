// Pointer ownership prevents one finger releasing a control held by another.
// Brief taps stay published long enough for the emulator's input polling.
export function wireMobileControls({ root = document, canvas, onChange, minimumPressMs = () => 100 }) {
  const pointers = new Map();
  const delayed = new Map();
  let screenAim = null;
  const emit = () => {
    const pressed = new Set(); const axes = { ...screenAim };
    for (const entry of [...delayed.values(), ...pointers.values()]) {
      if (entry.control) pressed.add(entry.control);
      if (entry.axes) Object.assign(axes, entry.axes);
    }
    // Publish input before touching the DOM so the emulator sees it first.
    const aiming = [...pointers.values()].some(entry => entry.axes?.cStickX !== undefined);
    onChange(pressed, axes, aiming);
    root.querySelectorAll('[data-touch-button]').forEach(element => element.classList.toggle('is-pressed', pressed.has(element.dataset.touchButton)));
    root.querySelectorAll('[data-touch-stick]').forEach(element => {
      const owner = [...pointers.values()].findLast(entry => entry.element === element);
      element.classList.toggle('is-active', Boolean(owner));
      if (!owner) {
        element.style.removeProperty('--stick-x'); element.style.removeProperty('--stick-y');
        return;
      }
      const knob = element.querySelector('.touch-stick-knob');
      const travel = Math.max(0, (element.clientWidth - (knob?.offsetWidth || 0)) / 2);
      const prefix = element.dataset.touchStick === 'main' ? 'stick' : 'cStick';
      element.style.setProperty('--stick-x', `${(owner.axes[`${prefix}X`] - 128) / 96 * travel}px`);
      element.style.setProperty('--stick-y', `${(128 - owner.axes[`${prefix}Y`]) / 96 * travel}px`);
    });
  };
  const capture = (element, id) => { try { element.setPointerCapture(id); } catch {} };
  const retainBriefPress = entry => {
    const remaining = (typeof minimumPressMs === 'function' ? minimumPressMs() : minimumPressMs) - (performance.now() - entry.started);
    if (!entry.control || remaining <= 0) return;
    const token = Symbol();
    // Screen taps publish aim and A as one input, including after pointerup.
    const retained = { control: entry.control, axes: entry.axes };
    retained.timer = setTimeout(() => { delayed.delete(token); emit(); }, remaining);
    delayed.set(token, retained);
  };
  const finish = (event, cancel = false) => {
    const entry = pointers.get(event.pointerId);
    if (!entry) return;
    event.preventDefault(); pointers.delete(event.pointerId);
    if (entry.screen && !cancel) screenAim = entry.axes;
    entry.element.style.removeProperty('--stick-x'); entry.element.style.removeProperty('--stick-y');
    if (!cancel) retainBriefPress(entry);
    emit();
  };
  const bind = (element, kind) => {
    const position = event => {
      const box = element.getBoundingClientRect();
      let x = (event.clientX - box.left) / box.width * 2 - 1;
      let y = 1 - (event.clientY - box.top) / box.height * 2;
      if (kind !== 'screen') { const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; } }
      x = Math.max(-1, Math.min(1, x)); y = Math.max(-1, Math.min(1, y));
      const prefix = kind === 'main' ? 'stick' : 'cStick';
      return { [`${prefix}X`]: Math.round(128 + x * 96), [`${prefix}Y`]: Math.round(128 + y * 96) };
    };
    element.addEventListener('pointerdown', event => {
      if (kind === 'screen' && event.pointerType !== 'touch') return;
      if (event.button > 0) return;
      event.preventDefault(); capture(element, event.pointerId);
      pointers.set(event.pointerId, { element, screen: kind === 'screen', started: performance.now(), control: kind === 'button' ? element.dataset.touchButton : kind === 'screen' ? 'A' : null, axes: kind === 'button' ? null : position(event) });
      emit();
    });
    const move = event => {
      const entry = pointers.get(event.pointerId);
      if (!entry) return;
      if (event.cancelable) event.preventDefault();
      if (kind === 'button') {
        if (event.type === 'pointerrawupdate') return;
        // Like Azahar, a finger can slide from one button to another.
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-touch-button]');
        const control = target && root.contains?.(target) ? target.dataset.touchButton : null;
        if (control !== entry.control) {
          retainBriefPress(entry);
          entry.control = control;
          entry.started = performance.now();
        }
      } else {
        const axes = position(event);
        if (entry.axes && Object.keys(axes).every(key => axes[key] === entry.axes[key])) return;
        entry.axes = axes;
      }
      emit();
    };
    element.addEventListener('pointermove', move);
    // pointermove is frame-aligned; raw updates move sticks without that wait.
    if (kind !== 'button' && 'onpointerrawupdate' in window) element.addEventListener('pointerrawupdate', move);
    element.addEventListener('pointerup', event => finish(event));
    element.addEventListener('pointercancel', event => finish(event, true));
    element.addEventListener('lostpointercapture', event => finish(event, true));
  };
  root.querySelectorAll('[data-touch-button]').forEach(element => bind(element, 'button'));
  root.querySelectorAll('[data-touch-stick]').forEach(element => bind(element, element.dataset.touchStick));
  if (canvas) bind(canvas, 'screen');
  const reset = () => {
    for (const entry of delayed.values()) clearTimeout(entry.timer);
    for (const entry of pointers.values()) { entry.element.style.removeProperty('--stick-x'); entry.element.style.removeProperty('--stick-y'); }
    pointers.clear(); delayed.clear(); screenAim = null; emit();
  };
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  return {
    reset,
    setCanvas(nextCanvas) {
      reset();
      if (nextCanvas && nextCanvas !== canvas) bind(nextCanvas, 'screen');
      canvas = nextCanvas;
    }
  };
}
