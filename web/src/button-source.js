// Keep short presses visible for a controller poll at the current game speed.
// Each physical key owns its press, including aliases mapped to one control.
export function createButtonSource(onChange, minimumPressMs = () => 100) {
  const held = new Map();
  const pending = new Map();
  const emit = () => onChange(new Set([...held.values(), ...pending.values()].map(entry => entry.control)));
  return {
    down(key, control) {
      if (held.has(key)) return;
      clearTimeout(pending.get(key)?.timer); pending.delete(key);
      held.set(key, { control, started: performance.now() }); emit();
    },
    up(key) {
      const entry = held.get(key);
      if (!entry) return;
      held.delete(key);
      const remaining = minimumPressMs() - (performance.now() - entry.started);
      if (remaining > 0) {
        entry.timer = setTimeout(() => { pending.delete(key); emit(); }, remaining);
        pending.set(key, entry);
      }
      emit();
    },
    reset() {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      held.clear(); pending.clear(); emit();
    }
  };
}
