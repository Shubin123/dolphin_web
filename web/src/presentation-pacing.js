export const FRESH_FRAME_DELIVERY = Object.freeze({
  IMMEDIATE: "immediate",
  QUEUED: "queued",
});

// Display callbacks pace presentation only. The core keeps its own real-time
// clock, so a 144 Hz screen must not run a 60 Hz Wii game 2.4 times faster.
export function startDisplayRefreshLoop(paint, clock = globalThis) {
  let stopped = false, handle, previous;
  if (typeof clock.requestAnimationFrame === "function") {
    const frame = timestamp => {
      if (stopped) return;
      const interval = previous === undefined ? 1000 / 60 : timestamp - previous;
      previous = timestamp;
      paint(Math.max(1, Math.min(50, interval)));
      if (!stopped) handle = clock.requestAnimationFrame(frame);
    };
    try {
      handle = clock.requestAnimationFrame(frame);
      return () => { stopped = true; clock.cancelAnimationFrame(handle); };
    } catch {
      // Some worker implementations expose RAF without supporting an owner.
    }
  }
  handle = clock.setInterval(() => paint(1000 / 60), 1000 / 60);
  return () => { stopped = true; clock.clearInterval(handle); };
}

export function legacyTickQueueRequested(search = "") {
  return new URLSearchParams(search).get("legacytickqueue") === "1";
}

export function freshFrameDeliveryForPacing(pacingMode, legacyTickQueue = false) {
  if (pacingMode === "smooth" || (pacingMode === "tick" && legacyTickQueue)) {
    return FRESH_FRAME_DELIVERY.QUEUED;
  }
  return FRESH_FRAME_DELIVERY.IMMEDIATE;
}
