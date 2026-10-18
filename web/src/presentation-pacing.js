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

// Releases emulated frames to the display at the game's own cadence. A Wii
// game makes ~60 frames/s; the emulator finishes them unevenly (8-28 ms
// apart), so presenting each on arrival shows frames for 1, 2 or 3 refreshes
// of a 120 Hz screen. Frames instead wait for a release clock that advances
// one game period per frame, so each holds the same number of refreshes.
// Guest timing is untouched: this only chooses WHEN a finished frame is shown.
export function createDisplayFramePacer({ maxQueued = 2, initialPeriodMs = 1000 / 60 } = {}) {
  const queue = [], arrivals = [];
  let periodMs = initialPeriodMs, lastArrival, releaseAt, releasedAt, shown = null;
  const stats = { released: 0, dropped: 0, repeats: 0, late: 0 };
  return {
    stats,
    get periodMs() { return periodMs; },
    get queued() { return queue.length; },
    get shown() { return shown; },
    // Returns the frames that will never be shown, so their storage can be reused.
    push(frame, now) {
      // Average over a window rather than per interval: individual intervals
      // are jittery, and clipping them would bias the rate. A stall restarts
      // the window. The guest's VI rate lies between 24 and 75 Hz.
      if (lastArrival !== undefined && now - lastArrival > 1000 / 12) arrivals.length = 0;
      arrivals.push(now);
      if (arrivals.length > 61) arrivals.shift();
      if (arrivals.length >= 9) {
        const mean = (now - arrivals[0]) / (arrivals.length - 1);
        if (mean >= 1000 / 75 && mean <= 1000 / 24) periodMs = mean;
      }
      lastArrival = now;
      queue.push(frame);
      const dropped = queue.length > maxQueued ? queue.splice(0, queue.length - maxQueued) : [];
      stats.dropped += dropped.length;
      return dropped;
    },
    // Called once per display refresh. Returns {show, retired}: the frame to
    // put on screen (null keeps the current image) and frames now unused.
    refresh(now, refreshMs) {
      const half = Math.min(refreshMs, periodMs) / 2;
      if (!queue.length) {
        if (releaseAt !== undefined && now + half >= releaseAt) {
          // The frame due now is late: hold the release clock one refresh
          // later, buying jitter headroom instead of judder on every frame.
          stats.repeats += 1;
          releaseAt += refreshMs;
        }
        return { show: null, retired: [] };
      }
      if (releaseAt === undefined || now - releaseAt > periodMs) {
        // First frame, or the display fell a whole period behind: restart the
        // clock instead of bursting to catch up.
        if (releaseAt !== undefined) stats.late += 1;
        releaseAt = now;
      }
      if (now + half < releaseAt) return { show: null, retired: [] };
      const retired = shown ? [shown] : [];
      shown = queue.shift();
      releasedAt = now;
      releaseAt += periodMs;
      // A full queue means frames wait longer than needed; recover latency.
      if (queue.length >= maxQueued) releaseAt -= Math.min(refreshMs, periodMs) / 2;
      stats.released += 1;
      return { show: shown, retired };
    },
    // The next frame to be shown, still queued (used to synthesize in-betweens).
    peek() { return queue[0] ?? null; },
    // How far the display is between the shown frame and the next, 0..1.
    phase(now) {
      return releasedAt === undefined ? 0 : Math.max(0, Math.min(1, (now - releasedAt) / periodMs));
    },
    reset() {
      const retired = [...queue, ...(shown ? [shown] : [])];
      queue.length = 0;
      shown = null; releaseAt = undefined; releasedAt = undefined; lastArrival = undefined;
      arrivals.length = 0;
      return retired;
    },
  };
}

// Display pacing is on by default for hardware WebGPU; ?displaypace=0 restores
// presenting each frame as soon as the emulator finishes it.
export function displayPacingRequested(search = "") {
  return new URLSearchParams(search).get("displaypace") !== "0";
}

// Motion-interpolated in-between frames are opt-in (?frameinterp=1): they add
// images above the game's frame rate but can smear HUD edges in fast motion.
export function frameInterpolationRequested(search = "") {
  return new URLSearchParams(search).get("frameinterp") === "1";
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
