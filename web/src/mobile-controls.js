// Pointer ownership prevents one finger releasing a control held by another.
// Brief taps stay published long enough for the emulator's input polling.
export function wireMobileControls({ root = document, canvas, onChange, minimumPressMs = () => 100 }) {
  const pointers = new Map();
  const delayed = new Map();
  const emit = () => {
    const pressed = new Set(); const axes = {};
    for (const entry of [...pointers.values(), ...delayed.values()]) {
      if (entry.control) pressed.add(entry.control);
      if (entry.axes) Object.assign(axes, entry.axes);
    }
    root.querySelectorAll('[data-touch-button]').forEach(element => element.classList.toggle('is-pressed', pressed.has(element.dataset.touchButton)));
    root.querySelectorAll('[data-touch-stick]').forEach(element => element.classList.toggle('is-active', [...pointers.values()].some(entry => entry.element === element)));
    onChange(pressed, axes);
  };
  const capture = (element, id) => { try { element.setPointerCapture(id); } catch {} };
  const finish = (event, cancel = false) => {
    const entry = pointers.get(event.pointerId);
    if (!entry) return;
    event.preventDefault(); pointers.delete(event.pointerId);
    entry.element.style.removeProperty('--stick-x'); entry.element.style.removeProperty('--stick-y');
    const remaining = (typeof minimumPressMs === 'function' ? minimumPressMs() : minimumPressMs) - (performance.now() - entry.started);
    if (!cancel && entry.control && remaining > 0) {
      const token = Symbol();
      delayed.set(token, { control: entry.control });
      delayed.get(token).timer = setTimeout(() => { delayed.delete(token); emit(); }, remaining);
    }
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
      if (kind !== 'screen') { element.style.setProperty('--stick-x', `${x * 30}px`); element.style.setProperty('--stick-y', `${-y * 30}px`); }
      return { [`${prefix}X`]: Math.round(128 + x * 96), [`${prefix}Y`]: Math.round(128 + y * 96) };
    };
    element.addEventListener('pointerdown', event => {
      if (kind === 'screen' && event.pointerType !== 'touch') return;
      if (event.button > 0) return;
      event.preventDefault(); capture(element, event.pointerId);
      pointers.set(event.pointerId, { element, started: performance.now(), control: kind === 'button' ? element.dataset.touchButton : kind === 'screen' ? 'A' : null, axes: kind === 'button' ? null : position(event) });
      emit();
    });
    element.addEventListener('pointermove', event => {
      const entry = pointers.get(event.pointerId);
      if (!entry) return;
      event.preventDefault();
      if (kind === 'button') {
        // Like Azahar, a finger can slide from one button to another.
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-touch-button]');
        entry.control = target && root.contains?.(target) ? target.dataset.touchButton : null;
      } else entry.axes = position(event);
      emit();
    });
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
    pointers.clear(); delayed.clear(); emit();
  };
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  return { reset };
}
