import { createButtonSource } from "./button-source.js";
import { wireMobileControls } from "./mobile-controls.js";
import { wireSaveStatePanel } from "./save-state-panel.js";
import { initLibrary } from "./library.js";
import { createBootProgress } from "./boot-progress.js";
import { lookupGameProfile, readGameId } from "./game-profiles.js";
import { AudioController } from "./audio.js";
import { EmulatorHost } from "./core-host.js";
import { startMainThreadProfiler } from "./main-profiler.js";
import { createCausalTelemetry, deepMerge } from "./causal-telemetry.js";
import {
  CONTROL_LABELS,
  DEFAULT_KEY_BINDINGS,
  formatControlLabel,
  gamepadInputsEqual,
  inputStateFromPressed,
  mergePressedSets,
  readGamepadInput,
  resolveKeyboardButton,
  selectPreferredGamepad
} from "./input.js";
import {
  buildPlayablePresetHref,
  buildSettingsHref,
  describeSettings,
  readSettingsFromSearch
} from "./settings.js";
import {
  requestedWgpuRendererWorkerProbe,
  shouldShowIntentionalBlankWgpuNotice
} from "./wgpu-replay-diagnostics.js";

const elements = {
  panelToggle: document.querySelector("#panelToggle"),
  controlPanel: document.querySelector("#controlPanel"),
  volumeDial: document.querySelector("#volumeDial"),
  aspectSelect: document.querySelector("#aspectSelect"),
  autoProfile: document.querySelector("#settingAutoProfile"),
  lcdTitle: document.querySelector("#lcdTitle"),
  lcdMeta: document.querySelector("#lcdMeta"),
  adapterStatus: document.querySelector("#adapterStatus"),
  audioStatus: document.querySelector("#audioStatus"),
  bootApploader: document.querySelector("#bootApploader"),
  bootBlocker: document.querySelector("#bootBlocker"),
  bootDol: document.querySelector("#bootDol"),
  bootEntry: document.querySelector("#bootEntry"),
  bootFst: document.querySelector("#bootFst"),
  bootImage: document.querySelector("#bootImage"),
  bootStatus: document.querySelector("#bootStatus"),
  blankProbeNotice: document.querySelector("#blankProbeNotice"),
  controlGrid: document.querySelector("#controlGrid"),
  coreLabel: document.querySelector("#coreLabel"),
  coreMode: document.querySelector("#coreMode"),
  debugPanel: document.querySelector("#debugPanel"),
  debugToggle: document.querySelector("#debugToggle"),
  dropBadge: document.querySelector("#dropBadge"),
  dropZone: document.querySelector("#dropZone"),
  frameCounter: document.querySelector("#frameCounter"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  fpsCounter: document.querySelector("#fpsCounter"),
  visualFpsCounter: document.querySelector("#visualFpsCounter"),
  gameSpeedCounter: document.querySelector("#gameSpeedCounter"),
  coreTicks: document.querySelector("#coreTicks"),
  coreFpsCounter: document.querySelector("#coreFpsCounter"),
  presentationGapCounter: document.querySelector("#presentationGapCounter"),
  presentationLagCounter: document.querySelector("#presentationLagCounter"),
  ppcPc: document.querySelector("#ppcPc"),
  cpuCoreName: document.querySelector("#cpuCoreName"),
  ppcWasmJit: document.querySelector("#ppcWasmJit"),
  ppcWasmHelperStats: document.querySelector("#ppcWasmHelperStats"),
  frameProfileStats: document.querySelector("#frameProfileStats"),
  uiFpsCounter: document.querySelector("#uiFpsCounter"),
  gameSize: document.querySelector("#gameSize"),
  gameTitle: document.querySelector("#gameTitle"),
  hudFps: document.querySelector("#hudFps"),
  hudJit: document.querySelector("#hudJit"),
  hudLatency: document.querySelector("#hudLatency"),
  hudResolution: document.querySelector("#hudResolution"),
  hudSpeed: document.querySelector("#hudSpeed"),
  hudVisualFps: document.querySelector("#hudVisualFps"),
  hudCoreFps: document.querySelector("#hudCoreFps"),
  hudFrame: document.querySelector("#hudFrame"),
  hudGlSwap: document.querySelector("#hudGlSwap"),
  hudMode: document.querySelector("#hudMode"),
  hudWatchdog: document.querySelector("#hudWatchdog"),
  hudGap: document.querySelector("#hudGap"),
  hudGlError: document.querySelector("#hudGlError"),
  hudDraw: document.querySelector("#hudDraw"),
  hudNz: document.querySelector("#hudNz"),
  hudUnderDrop: document.querySelector("#hudUnderDrop"),
  hudQueue: document.querySelector("#hudQueue"),
  hudJitCache: document.querySelector("#hudJitCache"),
  hudRunloop: document.querySelector("#hudRunloop"),
  hudWgx: document.querySelector("#hudWgx"),
  hudStatus: document.querySelector("#hudStatus"),
  inputSource: document.querySelector("#inputSource"),
  loadButton: document.querySelector("#loadButton"),
  dlStateButton: document.querySelector("#dlStateButton"),
  ulStateInput: document.querySelector("#ulStateInput"),
  mountNote: document.querySelector("#mountNote"),
  muteButton: document.querySelector("#muteButton"),
  overlayToggle: document.querySelector("#overlayToggle"),
  resetButton: document.querySelector("#resetButton"),
  romInput: document.querySelector("#romInput"),
  rootEntryList: document.querySelector("#rootEntryList"),
  runButton: document.querySelector("#runButton"),
  saveButton: document.querySelector("#saveButton"),
  screen: document.querySelector("#screen"),
  screenHud: document.querySelector("#screenHud"),
  settingCore: document.querySelector("#settingCore"),
  settingCpu: document.querySelector("#settingCpu"),
  settingFastSw: document.querySelector("#settingFastSw"),
  settingForceJit: document.querySelector("#settingForceJit"),
  settingJitTier: document.querySelector("#settingJitTier"),
  settingOglProxy: document.querySelector("#settingOglProxy"),
  settingPacing: document.querySelector("#settingPacing"),
  settingMetrics: document.querySelector("#settingMetrics"),
  settingPresenter: document.querySelector("#settingPresenter"),
  settingQueue: document.querySelector("#settingQueue"),
  settingResolution: document.querySelector("#settingResolution"),
  settingSpeed: document.querySelector("#settingSpeed"),
  settingVideo: document.querySelector("#settingVideo"),
  settingWasmJit: document.querySelector("#settingWasmJit"),
  settingsApplyButton: document.querySelector("#settingsApplyButton"),
  settingsForm: document.querySelector("#settingsForm"),
  settingsPresetButton: document.querySelector("#settingsPresetButton"),
  settingsSummary: document.querySelector("#settingsSummary"),
  statusPill: document.querySelector("#statusPill")
};

const DEBUG_PREF_KEY = "wasm-dolphin.debug-open";
const OSD_PREF_KEY = "wasm-dolphin.osd-visible";

const keyboardPressed = new Set();
let keyboardBindings = { ...DEFAULT_KEY_BINDINGS };
try { const saved = JSON.parse(localStorage.getItem("dolphin-keyboard-bindings") || "null"); if (saved && typeof saved === "object" && !Array.isArray(saved)) keyboardBindings = Object.fromEntries(Object.entries(saved).filter(([code, control]) => typeof code === "string" && CONTROL_LABELS.includes(control))); } catch {}
let mousePressed = new Set();
let mouseInputState = null;
const mouseMode = document.querySelector("#mouseMode");
const controllerSelect = document.querySelector("#controllerSelect");
const controllerStatus = document.querySelector("#controllerStatus");
const controllerDeadzone = document.querySelector("#controllerDeadzone");
let controllerSignature = "";

let touchPressed = new Set();
let touchInputState = {};
let gamepadPressed = new Set();
let gamepadInputState = null;
let lastGamepadInput = null;
let pointerSource = null;
let combinedPressed = new Set();
let lastFrameInfo = null;
let lastRuntimeUiTime = -Infinity;
let lastRuntimeUiState = "";
let lastCausalTelemetry = null;
let lastCausalTelemetryCapturedAt = -1;
let currentSettings = readSettingsFromSearch(window.location.search);
const requestedWgpuProbe = requestedWgpuRendererWorkerProbe(window.location.search);

if (elements.blankProbeNotice && shouldShowIntentionalBlankWgpuNotice(window.location.search)) {
  elements.blankProbeNotice.hidden = false;
  elements.blankProbeNotice.textContent =
    `Intentional blank diagnostic: ${requestedWgpuProbe}. Remove wgpurenderprobe to render game output.`;
}

const bootProgress = createBootProgress(elements.screen.parentElement);
const audio = new AudioController();
// Exposed for the validator: lets it unmute programmatically and tap the
// AudioContext via an AnalyserNode to check that audio is actually being
// produced during gameplay (Phase C of the smoothness/audio validator).
window.__audio = audio;
const host = new EmulatorHost({
  canvas: elements.screen,
  onFrame: handleFrame,
  onStatus: setStatus,
  onMode: setMode
});
audio.setSource((frames) => host.mixAudio(frames));
audio.setTransportBridge((config) => host.configureAudioWorklet(config));
// §28cx: expose the host so the main-thread profiler can read the existing
// >20ms stall counters (rAF loop vs worker→main message handler). LoAF's
// 50ms floor is blind to the 33-50ms band that actually starves the audio
// pump; these counters cover >20ms and attribute it to JS vs non-JS.
window.__host = host;

// Validator/dev hook: fetch a Dolphin .sav by URL and State::LoadAs it
// through the active adapter (worker → core LoadStateFile). Returns the
// worker response ({loaded, rc, beforeState, afterState}) so callers
// can tell a successful load from a build/version rejection.
window.__loadStateFile = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return { loaded: false, error: `fetch ${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const a = host.adapter;
    if (!a || typeof a.loadStateFile !== "function")
      return { loaded: false, error: "adapter has no loadStateFile" };
    return await a.loadStateFile(bytes);
  } catch (e) {
    return { loaded: false, error: String(e?.message || e) };
  }
};

// Capture a version-matched save state from THIS build; returns it
// base64-encoded so the validator can persist it (Playwright evaluate
// can't return an ArrayBuffer). Chunked to avoid call-stack limits.
window.__saveStateFile = async () => {
  try {
    const a = host.adapter;
    if (!a || typeof a.saveStateFile !== "function")
      return { saved: false, error: "adapter has no saveStateFile" };
    const r = await a.saveStateFile();
    if (!r || !r.bytes) return { saved: false, error: r?.error || "no bytes" };
    const u8 = new Uint8Array(r.bytes);
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH)
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return { saved: r.saved, size: r.size, b64: btoa(bin) };
  } catch (e) {
    return { saved: false, error: String(e?.message || e) };
  }
};

// One-call: capture a version-matched state and download it as a
// .sav file from the browser. Run window.__downloadSaveState() in the
// devtools console while in the battle scene. The downloaded file is
// loadable by this exact build via the validator's SAVE_STATE_URL.
window.__downloadSaveState = async (name) => {
  try {
    const a = host.adapter;
    if (!a || typeof a.saveStateFile !== "function")
      return { saved: false, error: "adapter has no saveStateFile" };
    const r = await a.saveStateFile();
    if (!r?.saved || !r.bytes?.byteLength) return { saved: false, error: r?.error || "Save-state capture failed" };
    const blob = new Blob([r.bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const gameName = (host.game?.name || host.game?.gameId || "game")
      .replace(/\.(iso|gcm|rvz|wbfs|wad|dol|elf)$/i, "").replace(/[^a-zA-Z0-9 _-]/g, "_").slice(0, 80);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = name || `${gameName}-${timestamp}.sav`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { saved: true, size: r.size, file: link.download };
  } catch (e) {
    return { saved: false, error: String(e?.message || e) };
  }
};

// Reload a state already in the worker FS (round-trip proof).
window.__loadStateFileFs = async (fsPath) => {
  try {
    const a = host.adapter;
    if (!a || typeof a.loadStateFileFromFs !== "function")
      return { loaded: false, error: "adapter has no loadStateFileFromFs" };
    return await a.loadStateFileFromFs(fsPath || "/savestate_out.sav");
  } catch (e) {
    return { loaded: false, error: String(e?.message || e) };
  }
};

renderControlGrid();
wireSettings();
wireDiagnostics();
wirePanelToggle();
wireVolumeDial();
wireAspectSelect();
wireUpscaling();
wireScreenFit();
wireFileMounting();
const saveStates = wireSaveStatePanel({
  root: document.querySelector("#saveStatePanel"),
  host,
  onLoaded: () => syncGameInfo(host.game),
  onStatus: setStatus,
  onAvailability: ({ canSave, canLoad }) => {
    elements.saveButton.disabled = !canSave;
    elements.loadButton.disabled = !canLoad;
    elements.dlStateButton.disabled = !canSave;
    elements.ulStateInput.disabled = !canSave;
    document.querySelectorAll('[data-state-action]').forEach(button => {
      button.disabled = button.dataset.stateAction === "load" ? !canLoad : !canSave;
    });
  },
  download: () => window.__downloadSaveState(),
  pickUpload: () => elements.ulStateInput.click(),
  upload: async file => {
    if (typeof host.adapter?.loadStateFile !== "function") {
      return { loaded: false, error: "This emulator does not support state files" };
    }
    return host.adapter.loadStateFile(new Uint8Array(await file.arrayBuffer()));
  }
});
wireTransport();
wireKeyboard();
wireTouchControls();
wireGamepadPolling();

// §28cx main-thread profiler — activates only with ?mainprof=1. Diagnoses
// what eats main-thread time (LoAF script attribution) and whether the audio
// pump's setInterval is being starved, the suspected cause of real-Chrome
// audio underruns the worker-only probe can't see.
startMainThreadProfiler();

host
  .init()
  .then(runSmokeScenario)
  .catch((error) => {
    setStatus(error.message, "error");
  });

function handleFrame(info) {
  if (
    info.causalTelemetry &&
    info.causalTelemetry.capturedAtMs !== lastCausalTelemetryCapturedAt
  ) {
    lastCausalTelemetry = createCausalTelemetry(deepMerge(info.causalTelemetry, {
      audio: audio.causalTelemetry()
    }));
    lastCausalTelemetryCapturedAt = info.causalTelemetry.capturedAtMs;
  }
  if (lastCausalTelemetry) info.causalTelemetry = lastCausalTelemetry;
  lastFrameInfo = info;
  bootProgress.frame(info);
  // Expose to the validator. Reading via window is cheaper than DOM
  // querySelector + textContent parsing and preserves structured
  // numeric fields (histogram array, stddev) without round-tripping
  // through human-readable strings.
  window.__lastFrameInfo = info;
  window.__causalTelemetry = info.causalTelemetry || null;
  const now = performance.now();
  const uiState = `${info.mode}:${info.running}:${audio.label()}`;
  if (uiState === lastRuntimeUiState && now - lastRuntimeUiTime < 100) return;
  lastRuntimeUiTime = now;
  lastRuntimeUiState = uiState;
  if (!elements.screenHud.hidden) updateScreenHud(info);
  updateRuntimeControls(info);

  if (!elements.debugPanel.hidden) {
    updateDebugMetrics(info);
  }
}

function updateRuntimeControls(info) {
  elements.coreMode.textContent = info.mode === "dolphin" ? "Dolphin" : "Demo";
  setTransportGlyph(elements.runButton, info.running ? GLYPH.pause : GLYPH.play,
                    info.running ? "Pause" : "Run",
                    info.running ? "Pause emulation" : "Resume emulation");
  elements.statusPill.classList.toggle("paused", !info.running);
  audio.update(info.buttonMask, info.running);
  setTransportGlyph(elements.muteButton,
                    /unmut/i.test(audio.label()) ? GLYPH.sound : GLYPH.muted,
                    audio.label(), "Mute or unmute audio");
}

function updateDebugMetrics(info) {
  elements.frameCounter.textContent = String(info.frame);
  elements.fpsCounter.textContent = String(info.fps);
  if (elements.visualFpsCounter) {
    elements.visualFpsCounter.textContent =
      info.visualChangeFps == null ? "n/a" : String(info.visualChangeFps);
  }
  if (elements.gameSpeedCounter) {
    elements.gameSpeedCounter.textContent = `${Math.max(0, Number(info.gameSpeed) || 0)}%`;
  }
  elements.uiFpsCounter.textContent = String(info.uiFps ?? info.fps);
  if (elements.coreFpsCounter) {
    elements.coreFpsCounter.textContent = String(info.coreFps ?? info.fps);
  }
  if (elements.presentationGapCounter) {
    const p95Gap = Number(info.presentationP95IntervalMs) || 0;
    const maxGap = Number(info.presentationMaxIntervalMs) || 0;
    const longFrames = Number(info.presentationLongFrameCount) || 0;
    const formattedP95 = p95Gap.toFixed(p95Gap >= 10 ? 0 : 1);
    const formattedMax = maxGap.toFixed(maxGap >= 10 ? 0 : 1);
    elements.presentationGapCounter.textContent = `${formattedP95} p95 / ${formattedMax} max / ${longFrames}`;
  }
  if (elements.presentationLagCounter) {
    const frameLag = Math.max(0, Number(info.presentationFrameLag) || 0);
    const queueAge = Math.max(0, Number(info.presentationQueueAgeMs) || 0);
    elements.presentationLagCounter.textContent =
      `${frameLag.toFixed(0)}f / ${queueAge.toFixed(queueAge >= 10 ? 0 : 1)} ms`;
  }
  if (elements.audioStatus) {
    elements.audioStatus.textContent = audio.stats || audio.label();
  }
  elements.coreTicks.textContent = formatLargeInteger(info.coreTicks || 0);
  elements.ppcPc.textContent = formatHex(info.ppcPc || 0) || "-";
  elements.cpuCoreName.textContent = info.cpuCoreName || "-";
  elements.ppcWasmJit.textContent = `${formatLargeInteger(info.ppcWasmBlockRunCount || 0)} / ${formatLargeInteger(info.ppcWasmBlockCompileCount || 0)}`;
  elements.ppcWasmHelperStats.textContent = info.ppcWasmHelperStats || "-";
  if (elements.frameProfileStats) {
    elements.frameProfileStats.textContent = info.frameProfileStats || "-";
  }
}

function setStatus(message, tone = "") {
  elements.statusPill.textContent = message;
  elements.statusPill.classList.toggle("error", tone === "error");
}

function setMode(message) {
  elements.coreLabel.textContent = message;
  elements.adapterStatus.textContent = message.includes("Dolphin") ? "Detected" : "Fallback";
}

function wireTransport() {
  elements.runButton.addEventListener("click", () => {
    if (lastFrameInfo?.running) {
      host.pause();
      setStatus("Paused");
      host.publishFrame();
    } else {
      setStatus("Running");
      host.start();
    }
  });

  elements.resetButton.addEventListener("click", () => {
    host.reset();
    setStatus("Reset");
  });

  elements.saveButton.addEventListener("click", () => saveStates.save());
  elements.loadButton.addEventListener("click", () => saveStates.load());

  // File transfers and browser slots share one operation guard.
  elements.dlStateButton.addEventListener("click", () => saveStates.download());

  elements.ulStateInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    await saveStates.upload(file);
  });

  elements.muteButton.addEventListener("click", async () => {
    const muted = !audio.muted;
    host.setAudioMuted(muted);
    await audio.setMuted(muted);
    setTransportGlyph(elements.muteButton,
                      /unmut/i.test(audio.label()) ? GLYPH.sound : GLYPH.muted,
                      audio.label(), "Mute or unmute audio");
  });

  elements.fullscreenButton.addEventListener("click", async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      if (elements.dropZone.classList.contains("is-pseudo-fullscreen")) {
        elements.dropZone.classList.remove("is-pseudo-fullscreen");
      } else if (elements.dropZone.requestFullscreen) {
        try { await elements.dropZone.requestFullscreen(); }
        catch { elements.dropZone.classList.add("is-pseudo-fullscreen"); }
      } else {
        elements.dropZone.classList.add("is-pseudo-fullscreen");
      }
      window.__touchControls?.update();
    }
  });
}

function wireSettings() {
  populateSettingsForm(currentSettings);
  updateSettingsSummary();

  elements.settingsForm.addEventListener("change", () => {
    currentSettings = collectSettingsForm();
    updateSettingsSummary();
  });

  elements.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextHref = buildSettingsHref(window.location.href, collectSettingsForm());
    window.location.assign(nextHref);
  });

  elements.settingsPresetButton.addEventListener("click", () => {
    window.location.assign(buildPlayablePresetHref(window.location.href));
  });
}

function wireDiagnostics() {
  const debugOpen = localStorage.getItem(DEBUG_PREF_KEY) === "1";
  const osdVisible = localStorage.getItem(OSD_PREF_KEY) !== "0";

  setDebugOpen(debugOpen);
  setOverlayVisible(osdVisible);

  elements.debugToggle.addEventListener("click", () => {
    setDebugOpen(elements.debugPanel.hidden);
  });

  elements.overlayToggle.addEventListener("click", () => {
    setOverlayVisible(elements.screenHud.hidden);
  });
}

function populateSettingsForm(settings) {
  elements.settingCore.value = settings.core;
  elements.settingVideo.value = settings.video;
  elements.settingResolution.value = settings.present;
  elements.settingSpeed.value = settings.speed;
  elements.settingCpu.value = settings.cpu;
  elements.settingPresenter.value = settings.presenter;
  elements.settingPacing.value = settings.pacing;
  elements.settingOglProxy.value = settings.oglproxy;
  elements.settingQueue.value = settings.queue;
  elements.settingFastSw.value = settings.fastsw;
  elements.settingJitTier.value = settings.jittier;
  elements.settingWasmJit.checked = settings.wasmjit === "1";
  elements.settingForceJit.checked = settings.forcejit === "1";
  elements.settingMetrics.checked = settings.metrics === "1";
}

function collectSettingsForm() {
  return {
    core: elements.settingCore.value,
    video: elements.settingVideo.value,
    present: elements.settingResolution.value,
    speed: elements.settingSpeed.value,
    cpu: elements.settingCpu.value,
    presenter: elements.settingPresenter.value,
    pacing: elements.settingPacing.value,
    oglproxy: elements.settingOglProxy.value,
    queue: elements.settingQueue.value,
    fastsw: elements.settingFastSw.value,
    wasmjit: elements.settingWasmJit.checked ? "1" : "0",
    jittier: elements.settingJitTier.value,
    forcejit: elements.settingForceJit.checked ? "1" : "0",
    metrics: elements.settingMetrics.checked ? "1" : "0"
  };
}

function updateSettingsSummary() {
  elements.settingsSummary.textContent = describeSettings(currentSettings);
}

function setDebugOpen(open) {
  elements.debugPanel.hidden = !open;
  elements.debugToggle.setAttribute("aria-expanded", String(open));
  elements.debugToggle.classList.toggle("active", open);
  elements.debugToggle.textContent = open ? "DBG on" : "DBG";
  localStorage.setItem(DEBUG_PREF_KEY, open ? "1" : "0");
  if (open && lastFrameInfo) {
    updateDebugMetrics(lastFrameInfo);
  }
  setAutoScreenshotEnabled(open);
}

// Auto-screenshot: when DBG is on, snapshot the visible canvas every 3s and
// download as a PNG. State is attached to globalThis directly without a
// const/let intermediate so the function works regardless of where
// setDebugOpen is called from during module init (lexical declarations
// hit TDZ if accessed before their source line during the same module
// evaluation pass).
function setAutoScreenshotEnabled(enabled) {
  const state = (globalThis.__autoScreenshotState ??= { timer: null, count: 0 });
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (!enabled) return;
  state.count = 0;
  state.timer = setInterval(captureCanvasSnapshot, 3000);
}

function captureCanvasSnapshot() {
  try {
    const canvas = document.querySelector("#screen");
    if (!canvas) return;
    // Render the visible canvas into an offscreen 2D canvas first so we can
    // turn the result into a PNG even if the original is a transferred
    // OffscreenCanvas placeholder (which has no .toDataURL of its own).
    const cw = canvas.clientWidth || canvas.width || 320;
    const ch = canvas.clientHeight || canvas.height || 240;
    const snap = document.createElement("canvas");
    snap.width = cw;
    snap.height = ch;
    const ctx = snap.getContext("2d", { alpha: false });
    if (!ctx) return;
    ctx.drawImage(canvas, 0, 0, cw, ch);
    const dataUrl = snap.toDataURL("image/png");
    const state = (globalThis.__autoScreenshotState ??= { timer: null, count: 0 });
    state.count += 1;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `wasm-dolphin-${ts}-shot${String(state.count).padStart(3, "0")}.png`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    console.warn("[auto-screenshot] failed:", err);
  }
}

function setOverlayVisible(visible) {
  elements.screenHud.hidden = !visible;
  elements.overlayToggle.setAttribute("aria-pressed", String(visible));
  elements.overlayToggle.classList.toggle("active", visible);
  elements.overlayToggle.textContent = visible ? "FPS on" : "FPS";
  localStorage.setItem(OSD_PREF_KEY, visible ? "1" : "0");
}


// Transport buttons are icons, so state changes swap the glyph and the
// accessible name. Writing textContent would delete the icon markup and leave
// a bare word inside a 44px key. Code points are numeric to keep this ASCII.
const GLYPH = {
  pause: String.fromCodePoint(0x23F8),
  play: String.fromCodePoint(0x25B6),
  muted: String.fromCodePoint(0x1F507),
  sound: String.fromCodePoint(0x1F50A)
};

function setTransportGlyph(button, glyph, label, tip) {
  if (!button) return;
  const span = button.querySelector(".glyph");
  const target = span || button;
  if (target.textContent !== glyph) target.textContent = glyph;
  if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
  if (tip && button.getAttribute("data-tip") !== tip) button.setAttribute("data-tip", tip);
}

// Hide the entire side panel, not just the settings block. The game identity
// it used to carry now lives on the LCD strip in the bezel, so nothing is lost
// when it is hidden and the screen gets the width back.
//
// localStorage can throw (private windows, blocked site data) and must never
// stop the page loading, hence the guards at both ends.
function wirePanelToggle() {
  const toggle = elements.panelToggle;
  const panel = elements.controlPanel;
  if (!toggle || !panel) return;
  // Widget visibility now lives in the Azahar layout menu.
  if (document.querySelector("#widget-grid")) { panel.hidden = false; document.body.classList.remove("panel-hidden"); return; }
  const apply = (open) => {
    panel.hidden = !open;
    document.body.classList.toggle("panel-hidden", !open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Hide side panel" : "Show side panel");
    toggle.classList.toggle("active", open);
  };
  let open = true;
  try { open = localStorage.getItem("wasmDolphinPanelOpen") !== "0"; } catch {}
  apply(open);
  toggle.addEventListener("click", () => {
    open = !open;
    apply(open);
    try { localStorage.setItem("wasmDolphinPanelOpen", open ? "1" : "0"); } catch {}
  });
}

// The dial is a range input under a drawn face: real keyboard and screen-reader
// behaviour for free, with the knob rotation driven off its value.
function wireVolumeDial() {
  const dial = elements.volumeDial;
  if (!dial) return;
  const face = dial.parentElement?.querySelector(".dial-face");
  const apply = () => {
    const pct = Number(dial.value) / 100;
    // -135deg (silent) to +135deg (full), the usual travel for a physical pot.
    if (face) face.style.setProperty("--angle", `${-135 + pct * 270}deg`);
    dial.parentElement?.setAttribute("data-tip", `Volume ${dial.value}%`);
  };
  dial.addEventListener("input", () => {
    audio.setVolume(Number(dial.value) / 100);
    apply();
    setTransportGlyph(elements.muteButton,
                      /unmut/i.test(audio.label()) ? GLYPH.sound : GLYPH.muted,
                      audio.label(), "Mute or unmute audio");
  });
  apply();
}

// Mirror the game identity onto the bezel LCD.
function updateLcd(title, meta) {
  if (elements.lcdTitle) elements.lcdTitle.textContent = (title || "NO DISC").toUpperCase();
  if (elements.lcdMeta) elements.lcdMeta.textContent = (meta || "").toUpperCase();
}

// Screen aspect. The ratio is published as two CSS custom properties rather
// than a single "4 / 3" string so the fullscreen rule can do arithmetic with
// it -- fitting the picture to the real display instead of assuming 16:9.
function wireAspectSelect() {
  const select = elements.aspectSelect;
  if (!select) return;
  const apply = (value) => {
    const [w, h] = String(value).split(":");
    const root = document.documentElement;
    root.style.setProperty("--aspect-w", String(Number(w) || 4));
    root.style.setProperty("--aspect-h", String(Number(h) || 3));
  };
  let saved = null;
  try { saved = localStorage.getItem("wasmDolphinAspect"); } catch {}
  if (saved && [...select.options].some((o) => o.value === saved)) select.value = saved;
  apply(select.value);
  select.addEventListener("change", () => {
    apply(select.value);
    try { localStorage.setItem("wasmDolphinAspect", select.value); } catch {}
  });
}


// The CRT fits itself with a CSS min() against the available height, but that
// needs to know how much vertical space the non-picture chrome takes -- the
// page header, the LCD strip, the footer and the paddings. That was a magic
// 210px, which overflowed by a few pixels in short windows because the real
// value changes with the layout. Measure it instead and publish it as
// --crt-chrome; the CSS keeps doing the fitting.
function wireScreenFit() {
  const set = elements.dropZone;
  const viewport = document.querySelector(".screen-viewport");
  if (!set || !viewport) return;

  let lastChrome = -1;
  const measure = () => {
    if (document.fullscreenElement) return;  // fullscreen has its own rule
    const setBox = set.getBoundingClientRect();
    const vpBox = viewport.getBoundingClientRect();
    // Everything above the console, plus the console's own non-picture parts,
    // plus the gap left below it.
    const above = setBox.top + window.scrollY;
    const withinSet = setBox.height - vpBox.height;
    const chrome = Math.max(0, Math.round(above + withinSet + 24));
    // Writing this property resizes the console, which retriggers the
    // ResizeObserver. Only write on a real change, or the two feed each other
    // forever.
    if (Math.abs(chrome - lastChrome) <= 1) return;
    lastChrome = chrome;
    document.documentElement.style.setProperty("--crt-chrome", `${chrome}px`);
  };

  measure();
  window.addEventListener("resize", measure, { passive: true });
  document.addEventListener("fullscreenchange", measure);
  // The panel toggle and aspect changes both reflow the console.
  if (window.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(measure)).observe(set);
}

function wireFileMounting() {
  elements.romInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) {
      await mountFile(file);
    }
  });

  for (const eventName of ["dragenter", "dragover"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("dragging");
      elements.dropBadge.textContent = "Release";
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    elements.dropZone.addEventListener(eventName, () => {
      elements.dropZone.classList.remove("dragging");
      elements.dropBadge.textContent = "Drop disc";
    });
  }

  elements.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    const [file] = event.dataTransfer.files;
    if (file) {
      await mountFile(file);
    }
  });
}

function updateScreenHud(info) {
  elements.hudFps.textContent = formatMetricNumber(info.presentationFps ?? info.fps);
  elements.hudVisualFps.textContent =
    info.visualChangeFps == null ? "n/a" : formatMetricNumber(info.visualChangeFps);
  elements.hudSpeed.textContent = `${Math.max(0, Number(info.gameSpeed) || 0)}%`;
  elements.hudLatency.textContent = formatPresentationLag(info);
  elements.hudJit.textContent = parseJitState(info);
  elements.hudResolution.textContent = parsePresentationResolution(info);

  // Diagnostic fields parsed out of the worker's helper-stats string.
  const helper = String(info.ppcWasmHelperStats || "");
  elements.hudCoreFps.textContent = `${Math.max(0, Number(info.coreFps) || 0)}`;
  elements.hudFrame.textContent = `${info.frame ?? 0}`;

  const oglSwap = /\bogl_swap:(\d+)/.exec(helper)?.[1] ?? "0";
  elements.hudGlSwap.textContent = oglSwap;

  const present = /present\s+(\w+)\s+signal:(\w+)\s+mode:(\w+)/.exec(helper);
  if (present) {
    elements.hudMode.textContent = `${present[1]}/${present[3]}`;
  } else {
    elements.hudMode.textContent = "-";
  }

  const wd = /\bwd:(\d+)\/(\d+)/.exec(helper);
  elements.hudWatchdog.textContent = wd ? `${wd[1]}/${wd[2]}` : "0/0";

  const p95 = Number(info.presentationP95IntervalMs) || 0;
  const maxGap = Number(info.presentationMaxIntervalMs) || 0;
  elements.hudGap.textContent = `${Math.round(p95)}/${Math.round(maxGap)}`;

  const glerr = Number(info.oglGlError) || 0;
  elements.hudGlError.textContent = `0x${glerr.toString(16)}`;

  // §28v: richer diagnostic badges parsed from the worker helper
  // string so screenshots carry render/JIT health at a glance.
  const prim = /\bprim:(\d+)/.exec(helper)?.[1] ?? "0";
  const draw = /\bdraw:(\d+)/.exec(helper)?.[1] ?? "0";
  elements.hudDraw.textContent = `${prim}/${draw}`;

  const nz = /\bnz:(\d+)/.exec(helper)?.[1];
  elements.hudNz.textContent = nz == null ? "n/a" : nz;

  const under = /\bunderrun:(\d+)/.exec(helper)?.[1] ?? "0";
  const drop = /\bdrop:(\d+)/.exec(helper)?.[1] ?? "0";
  elements.hudUnderDrop.textContent = `${under}/${drop}`;

  const q = /\bqueue:(\d+)\/(\d+)/.exec(helper);
  const sig = /\bsignal:(\w+)/.exec(helper)?.[1] ?? "?";
  elements.hudQueue.textContent = q ? `${q[1]}/${q[2]}:${sig}` : `-:${sig}`;

  const jitc = /\bjitc:(\d+)\/(\d+)/.exec(helper);
  elements.hudJitCache.textContent = jitc ? `${jitc[1]}/${jitc[2]}` : "0/0";

  // §28cn per-slice CPU pthread profiler: avg/max/runOnlyMax wall time per
  // CoreTiming slice. max > 16000us = blew one 60Hz frame; runOnlyMax
  // separated from max so we can see whether the spike was compile-burst
  // or pure-emulation cost.
  const runloop = /\brunloop:(\d+)slices\/avg(\d+)us\/max(\d+)us\/runOnlyMax(\d+)us/.exec(helper);
  if (elements.hudRunloop) {
    elements.hudRunloop.textContent = runloop
      ? `${runloop[2]}/${runloop[3]}/${runloop[4]}`
      : "-/-/-";
  }

  const wgx = /\bwgx:d(\d+)\/mp(\d+)\/mb(\d+)\/sk(\d+)/.exec(helper);
  elements.hudWgx.textContent = wgx
    ? `d${wgx[1]} mp${wgx[2]} mb${wgx[3]} sk${wgx[4]}`
    : "-";

  if (elements.statusPill && elements.hudStatus) {
    const txt = elements.statusPill.textContent || "";
    elements.hudStatus.textContent = txt.length > 80 ? txt.slice(0, 77) + "..." : txt;
  }
}


// Pick the renderer from measured per-game results before the core loads.
//
// The id is read straight from the disc file rather than from the mounted core,
// because by the time the core can report it the backend is already fixed --
// changing it then would mean a restart, and the file selection is gone.
//
// Only applies when the user has not chosen a renderer explicitly, either by
// URL flag or in the settings panel. A measured default is a good guess, not a
// reason to override someone who has already decided.
async function applyGameProfile(file) {
  if (!elements.autoProfile?.checked) return;
  if (new URLSearchParams(window.location.search).has("video")) return;
  let gameId = null;
  try {
    gameId = await readGameId(file);
  } catch {
    return;  // unreadable header is not a reason to fail the mount
  }
  const profile = lookupGameProfile(gameId);
  if (!profile) return;
  const backend = profile.renderer === "hardware" ? "WebGPU-Real" : "Software Renderer";
  if (host.applyVideoBackend(backend)) {
    setStatus(`${gameId}: ${profile.renderer} renderer (${profile.why})`);
  }
}

async function mountFile(file, { progress = true } = {}) {
  // The library may already have started the bar for a download or cache read.
  if (progress && !bootProgress.active) bootProgress.begin(file.name);
  bootProgress.stage("core");
  try {
    await applyGameProfile(file);
    const game = await host.mountFile(file);
    // A failed adapter falls back to the demo core instead of throwing.
    if (host.mode === "dolphin") bootProgress.stage("boot");
    else bootProgress.fail(elements.statusPill.textContent || "The Dolphin core could not start.");
    // Auto-unmute on disc boot. AudioController defaults to muted because
    // the AudioContext can only be created after a user gesture; the disc
    // mount click is the user gesture, so unmute here so audio actually
    // plays. Users can still mute via the button.
    if (audio.muted) {
      await audio.setMuted(false);
      setTransportGlyph(elements.muteButton,
                        /unmut/i.test(audio.label()) ? GLYPH.sound : GLYPH.muted,
                        audio.label(), "Mute or unmute audio");
    }
    host.setAudioMuted(audio.muted);
    syncGameInfo(game);
    host.start();
    // Give gameplay the keyboard after Open disc or cached Play, including
    // when a library search field was focused before the game mounted.
    elements.screen.focus({ preventScroll: true });
    return true;
  } catch (error) {
    setStatus(error.message, "error");
    bootProgress.fail(error.message);
    return false;
  }
}

function syncGameInfo(game) {
  elements.gameTitle.textContent = game.name;
  elements.gameSize.textContent = game.size ? formatBytes(game.size) : "No file";
  const coreDetail = [game.gameId, game.platform, game.region].filter(Boolean).join(" / ");
  // Feed the bezel LCD the same identity, so hiding the side panel loses
  // nothing. Size sits next to the id/platform/region the panel showed.
  updateLcd(game.name, [coreDetail, game.size ? formatBytes(game.size) : ""]
    .filter(Boolean).join("  ·  "));
  elements.mountNote.textContent =
    host.mode === "dolphin"
      ? `${game.core || "Dolphin core"} active${coreDetail ? `: ${coreDetail}` : ""}`
      : "Demo WASM core active";
  syncBootInfo(game);
  saveStates.refresh();
}

function syncBootInfo(game) {
  const mounted = host.mode === "dolphin" && game?.gameId;
  elements.bootStatus.textContent = mounted ? `${game.rootEntryCount ?? 0} root` : "No disc";
  elements.bootApploader.textContent = mounted
    ? [formatBytesMaybe(game.apploaderSize), game.apploaderDate].filter(Boolean).join(" / ")
    : "-";
  elements.bootDol.textContent = mounted ? formatOffsetSize(game.bootDolOffset, game.bootDolSize) : "-";
  elements.bootFst.textContent = mounted ? formatOffsetSize(game.fstOffset, game.fstSize) : "-";
  elements.bootImage.textContent = mounted ? formatImageSizes(game.rawSize, game.dataSize) : "-";
  elements.bootEntry.textContent = mounted ? formatHex(game.bootProbe?.dol?.entryPoint) || "-" : "-";
  elements.bootBlocker.textContent = mounted
    ? [game.bootProbe?.blocker, game.coreStatus].filter(Boolean).join(" / ") || "Boot probe unavailable"
    : "No boot attempt";
  renderRootEntries(mounted ? game.rootEntries ?? [] : []);
}

function renderRootEntries(entries) {
  elements.rootEntryList.replaceChildren();

  if (entries.length === 0) {
    const empty = document.createElement("span");
    empty.className = "root-entry-empty";
    empty.textContent = "No root entries";
    elements.rootEntryList.append(empty);
    return;
  }

  for (const entry of entries.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "root-entry";

    const name = document.createElement("span");
    name.textContent = entry.path || entry.name || "/";

    const size = document.createElement("strong");
    size.textContent = entry.directory ? "dir" : formatBytesMaybe(entry.size);

    row.append(name, size);
    elements.rootEntryList.append(row);
  }
}

function wireKeyboard() {
  const source = createButtonSource(pressed => {
    keyboardPressed.clear();
    for (const control of pressed) keyboardPressed.add(control);
    syncInput("Keyboard");
  }, minimumInputPressMs);
  const bindings = document.querySelector("#keyboardBindings");
  function renderBindings() {
    bindings.replaceChildren();
    for (const control of CONTROL_LABELS) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.binding = control;
      const key = Object.keys(keyboardBindings).find(code => keyboardBindings[code] === control);
      button.textContent = `${formatControlLabel(control)}: ${key || "Unassigned"}`;
      button.addEventListener("click", () => {
        button.textContent = `${formatControlLabel(control)}: press a key (Escape cancels)`;
        button.focus();
        const capture = event => {
          event.preventDefault(); event.stopImmediatePropagation();
          if (event.code !== "Escape") {
            for (const code of Object.keys(keyboardBindings)) if (keyboardBindings[code] === control) delete keyboardBindings[code];
            keyboardBindings[event.code] = control;
            try { localStorage.setItem("dolphin-keyboard-bindings", JSON.stringify(keyboardBindings)); } catch {}
          }
          source.reset();
          renderBindings();
        };
        button.addEventListener("keydown", capture, { once: true });
      });
      bindings.append(button);
    }
  }
  renderBindings();
  document.querySelector("#resetBindings").addEventListener("click", () => {
    keyboardBindings = { ...DEFAULT_KEY_BINDINGS };
    try { localStorage.removeItem("dolphin-keyboard-bindings"); } catch {}
    source.reset(); renderBindings();
  });
  const releaseAll = () => {
    source.reset(); touchPressed.clear(); mousePressed.clear(); mouseInputState = null;
    gamepadPressed.clear(); gamepadInputState = null; lastGamepadInput = null;
    pointerSource = null;
    syncInput("Ready");
  };
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });
  wireMouse();
  document.addEventListener("keydown", (event) => {
    if (event.target.closest?.("input, select, textarea, [contenteditable=true]")) return;
    if (event.repeat) {
      return;
    }

    const button = resolveKeyboardButton(event.code, keyboardBindings);
    if (!button) {
      return;
    }

    event.preventDefault();
    source.down(event.code, button);
  });

  document.addEventListener("keyup", (event) => {
    const button = resolveKeyboardButton(event.code, keyboardBindings);
    if (!button) {
      return;
    }

    event.preventDefault();
    source.up(event.code);
  });
}

function wireMouse() {
  const canvas = elements.screen;
  const viewport = canvas.closest(".screen-viewport");
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", () => canvas.focus({ preventScroll: true }));
  canvas.style.touchAction = "none";
  const buttons = createButtonSource(pressed => { mousePressed = pressed; syncInput("Mouse"); }, minimumInputPressMs);
  const release = () => { mouseInputState = null; buttons.reset(); };
  const applyMode = () => {
    viewport.dataset.mouseMode = mouseMode.value;
    release();
  };
  mouseMode.addEventListener("change", applyMode);
  applyMode();
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", () => { if (document.hidden) release(); });
  canvas.addEventListener("contextmenu", event => { if (mouseMode.value !== "off") event.preventDefault(); });
  canvas.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse" || mouseMode.value === "off") return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const control = ["A", "Z", "B"][event.button];
    move(event);
    if (control) buttons.down(event.button, control);
  });
  function move(event) {
    if (event.pointerType !== "mouse" || mouseMode.value === "off") return;
    if (mouseMode.value === "stick" && !canvas.hasPointerCapture(event.pointerId)) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const axis = (position, start, size) => Math.round(128 + Math.max(-1, Math.min(1, (position - start) / size * 2 - 1)) * 96);
    const x = axis(event.clientX, rect.left, rect.width);
    const y = 256 - axis(event.clientY, rect.top, rect.height);
    const next = mouseMode.value === "stick" ? { stickX: x, stickY: y } : { cStickX: x, cStickY: y };
    if ((mouseMode.value === "stick" || pointerSource === "mouse") &&
        Object.keys(next).every(key => mouseInputState?.[key] === next[key])) return;
    mouseInputState = next;
    if (mouseMode.value === "cstick") pointerSource = "mouse";
    syncInput("Mouse");
  }
  // Listen on the picture container so HUD overlays cannot interrupt hover.
  // Normalize against the displayed canvas in either windowed or fullscreen.
  viewport.addEventListener("pointerenter", move);
  viewport.addEventListener("pointermove", move);
  if ("onpointerrawupdate" in window) viewport.addEventListener("pointerrawupdate", move);
  canvas.addEventListener("pointerup", event => {
    if (event.pointerType !== "mouse") return;
    if (!event.buttons && mouseMode.value === "stick") mouseInputState = null;
    buttons.up(event.button);
  });
  viewport.addEventListener("pointerleave", event => {
    if (event.pointerType === "mouse" && !event.buttons) release();
  });
  canvas.addEventListener("pointercancel", event => { if (event.pointerType === "mouse") release(); });
  canvas.addEventListener("lostpointercapture", event => {
    // Normal mouse-up ends capture, but absolute Wii aim stays at the click.
    if (event.pointerType === "mouse" && !event.buttons && mouseMode.value === "cstick") return;
    if (event.pointerType === "mouse") release();
  });
}

function wireUpscaling() {
  const select = document.querySelector("#displayUpscaling");
  const preference = "dolphin-display-upscaling";
  try {
    const saved = localStorage.getItem(preference);
    if (["default", "smooth", "crisp"].includes(saved)) select.value = saved;
  } catch {}
  const apply = () => {
    // Browser composition scales the existing game surface, including an
    // OffscreenCanvas. No additional framebuffer, render pass or upload.
    elements.dropZone.dataset.upscaling = select.value;
  };
  apply();
  select.addEventListener("change", () => {
    apply();
    try { localStorage.setItem(preference, select.value); } catch {}
  });
}

function minimumInputPressMs() {
  // Wii/GC controllers poll in guest time. At 10% speed a 60ms tap can fall
  // entirely between polls; retain two guest frames, up to one wall second.
  const speed = Number(lastFrameInfo?.gameSpeed) || 100;
  return Math.max(100, Math.min(1000, Math.ceil(10000 / (3 * speed))));
}

function wireTouchControls() {
  const deck = document.querySelector("#touch-controls");
  elements.dropZone.append(deck);
  // Fullscreen hides the footer, so keep save/load for the selected slot here.
  const actions = document.createElement("div");
  actions.className = "fullscreen-actions";
  const action = (label, title, run, className = "", stateAction = "") => {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.title = title;
    if (className) button.className = className;
    if (stateAction) {
      button.dataset.stateAction = stateAction;
      button.disabled = true;
    }
    button.addEventListener("click", run);
    actions.append(button);
  };
  action("💾 Save", "Save to the selected slot", () => saveStates.save(), "", "save");
  action("↺ Load", "Load the selected slot", () => saveStates.load(), "", "load");
  action("✕ Exit", "Exit fullscreen", () => elements.fullscreenButton.click(), "fullscreen-exit");
  elements.dropZone.querySelector(".screen-viewport").append(actions);
  const controls = wireMobileControls({ canvas: elements.screen, minimumPressMs: minimumInputPressMs, onChange: (pressed, axes, aiming) => {
    if (aiming) pointerSource = "touch";
    touchPressed = pressed; touchInputState = axes; syncInput("Touch");
  } });
  const mode = document.querySelector("#touchMode");
  const size = document.querySelector("#touchSize");
  const opacity = document.querySelector("#touchOpacity");
  const applyLook = () => {
    elements.dropZone.style.setProperty("--tc-scale", String(Number(size.value) / 100));
    elements.dropZone.style.setProperty("--tc-opacity", String(Number(opacity.value) / 100));
  };
  try {
    const look = JSON.parse(localStorage.getItem("dolphin-touch-look") || "{}");
    if (Number(look.size) >= 70 && Number(look.size) <= 150) size.value = String(look.size);
    if (Number(look.opacity) >= 20 && Number(look.opacity) <= 100) opacity.value = String(look.opacity);
  } catch {}
  for (const input of [size, opacity]) input.addEventListener("input", () => {
    applyLook();
    try { localStorage.setItem("dolphin-touch-look", JSON.stringify({ size: size.value, opacity: opacity.value })); } catch {}
    update();
  });
  applyLook();
  // Long-press menus and callouts cancel held buttons on phones.
  deck.addEventListener("contextmenu", event => event.preventDefault());
  const coarse = matchMedia("(pointer: coarse)");
  let connected = false;
  try { const saved = localStorage.getItem("dolphin-touch-controls"); if (["auto", "on", "off"].includes(saved)) mode.value = saved; } catch {}
  const update = () => {
    deck.hidden = !(mode.value === "on" || (mode.value === "auto" && coarse.matches && !connected));
    elements.dropZone.classList.toggle("has-touch-controls", !deck.hidden);
    if (deck.hidden) controls.reset();
    const height = deck.hidden ? 0 : deck.getBoundingClientRect().height;
    elements.dropZone.style.setProperty("--screen-space", `calc(100dvh - ${height}px)`);
  };
  mode.addEventListener("change", () => { try { localStorage.setItem("dolphin-touch-controls", mode.value); } catch {} update(); });
  coarse.addEventListener("change", update);
  document.addEventListener("fullscreenchange", update);
  window.addEventListener("resize", update);
  document.addEventListener("keydown", event => { if (event.key === "Escape") { elements.dropZone.classList.remove("is-pseudo-fullscreen"); update(); } });
  window.__touchControls = { setGamepadConnected(value) { if (connected !== value) { connected = value; update(); } }, update };
  update();
}

function wireGamepadPolling() {
  // §28cj diagnostic + escape-hatch modes. URL params:
  //   ?nogamepad=1     — skip gamepad polling entirely; keyboard-only play
  //   ?gamepaddebug=1  — per-frame console dump + sticky on-page HUD of
  //                      every navigator.getGamepads() entry (id, mapping,
  //                      axes, pressed buttons). Use to attribute phantom
  //                      inputs when split-deadzone tuning isn't enough.
  const params = new URLSearchParams(window.location.search);
  if (params.get("nogamepad") === "1") {
    console.log("[gamepad] disabled via ?nogamepad=1 — keyboard/touch only this session");
    return;
  }
  const debugGamepad = params.get("gamepaddebug") === "1";
  const legacyGamepadPoll = params.get("legacygamepadpoll") === "1";
  let _gpLastLog = 0;
  let _gpHud = null;
  if (debugGamepad) {
    _gpHud = document.createElement("pre");
    _gpHud.id = "gamepad-debug-hud";
    Object.assign(_gpHud.style, {
      position: "fixed",
      top: "8px",
      right: "8px",
      maxWidth: "560px",
      maxHeight: "60vh",
      overflow: "auto",
      padding: "8px 10px",
      background: "rgba(0,0,0,0.85)",
      color: "#0f0",
      font: "11px/1.3 ui-monospace,Menlo,Consolas,monospace",
      zIndex: 99999,
      pointerEvents: "none",
      whiteSpace: "pre",
      border: "1px solid #0f0",
      borderRadius: "4px"
    });
    _gpHud.textContent = "[gamepad-debug] waiting for first poll…";
    document.body.appendChild(_gpHud);
  }

  // Poll on a 2ms interval rather than rAF. The Gamepad API has no event
  // model so we must poll, but rAF caps the cadence at the display refresh
  // rate (~16.7ms), which adds a worst-case full-frame of latency to every
  // gamepad input. Request 2ms polling while a pad is selected (browser timer
  // clamping still applies); idle/disabled polling uses 100ms, hidden uses 250ms.
  // Connection, selection and visibility events wake the loop immediately.
  let pollDelay = 100;
  let pollTimer;
  const poll = () => {
    const pads = navigator.getGamepads?.() ?? [];
    // §28ck device selection. `pads.find(Boolean)` (the old code) picked
    // index [0] regardless of whether it was a real controller or a
    // phantom HID device with empty mapping and axes stuck at extremes
    // (e.g. Xbox accessory at Product 0x03c3 with all axes pinned to -1).
    // Prefer pads with W3C `mapping === "standard"` — those are real
    // controllers whose button/axis indexes match our STANDARD_GAMEPAD_*
    // assumptions. Fall back to first non-null only if no standard pad
    // is present. Among multiple standard pads, the one with the highest
    // button count usually wins (Xbox Wireless = 17, generic = fewer).
    const devices = Array.from(pads).filter(pad => pad?.connected !== false && pad);
    const signature = devices.map(pad => `${pad.index}:${pad.id}`).join("|");
    if (signature !== controllerSignature) {
      controllerSignature = signature;
      const selected = controllerSelect.value;
      controllerSelect.replaceChildren(new Option("Automatic", "auto"), new Option("Disabled", "off"), ...devices.map(pad => new Option(pad.id, String(pad.index))));
      controllerSelect.value = Array.from(controllerSelect.options).some(option => option.value === selected) ? selected : "auto";
    }
    const firstPad = document.hidden || controllerSelect.value === "off" ? null : controllerSelect.value === "auto" ? selectPreferredGamepad(devices) : devices.find(pad => String(pad.index) === controllerSelect.value);
    pollDelay = document.hidden ? 250 : firstPad ? 8 : 100;
    const status = firstPad ? `${firstPad.id} · ${firstPad.mapping || "nonstandard mapping"}` : controllerSelect.value === "off" ? "Controller disabled" : "Pair in device Bluetooth settings, then press a controller button.";
    if (controllerStatus.textContent !== status) controllerStatus.textContent = status;

    if (debugGamepad) {
      const now = performance.now();
      if (now - _gpLastLog > 250) {
        _gpLastLog = now;
        const lines = [`[gamepad-debug] pads.length=${pads.length} t=${(now/1000).toFixed(1)}s`];
        let anyPad = false;
        for (let i = 0; i < pads.length; i++) {
          const p = pads[i];
          if (!p) { lines.push(`  [${i}] null`); continue; }
          anyPad = true;
          const axes = (p.axes || []).map((a, j) => `a${j}=${a.toFixed(3)}`).join(" ");
          const pressedBtns = [];
          for (let b = 0; b < (p.buttons || []).length; b++) {
            const btn = p.buttons[b];
            if (btn?.pressed || (btn?.value ?? 0) > 0.05) {
              pressedBtns.push(`b${b}=${(btn.value ?? (btn.pressed ? 1 : 0)).toFixed(2)}`);
            }
          }
          lines.push(`  [${i}] id="${p.id}"`);
          lines.push(`      mapping=${p.mapping || "?"} connected=${p.connected} buttons=${(p.buttons||[]).length} axes=${(p.axes||[]).length}`);
          lines.push(`      ${axes}`);
          lines.push(`      pressed:[${pressedBtns.join(" ") || "(none)"}]`);
        }
        if (!anyPad) lines.push("  (no gamepad detected yet — press a button on the controller to wake the API)");
        const text = lines.join("\n");
        if (_gpHud) _gpHud.textContent = text;
        // Also log once per second to console for copy-paste convenience.
        if (now - (_gpLastLog - 250) > 1000 || _gpLastLog < 1500) {
          // eslint-disable-next-line no-console
          console.log(text);
        }
      }
    }

    window.__touchControls?.setGamepadConnected(Boolean(firstPad));
    const nextGamepadInput = firstPad ? readGamepadInput(firstPad, 0.55, Number(controllerDeadzone.value)) : null;
    if (!legacyGamepadPoll && gamepadInputsEqual(lastGamepadInput, nextGamepadInput)) {
      return;
    }

    const pointerChanged = nextGamepadInput?.state.cStickX !== lastGamepadInput?.state.cStickX ||
      nextGamepadInput?.state.cStickY !== lastGamepadInput?.state.cStickY;
    if (pointerChanged && (pointerSource === "gamepad" ||
        (nextGamepadInput && (nextGamepadInput.state.cStickX !== 128 || nextGamepadInput.state.cStickY !== 128)))) pointerSource = "gamepad";
    lastGamepadInput = nextGamepadInput;
    gamepadPressed = nextGamepadInput?.pressed ?? new Set();
    gamepadInputState = nextGamepadInput?.state ?? null;

    if (gamepadPressed.size > 0) {
      syncInput("Gamepad");
    } else {
      syncInput(elements.inputSource.textContent === "Gamepad" ? "Keyboard" : elements.inputSource.textContent);
    }
  };

  const tick = () => { poll(); pollTimer = setTimeout(tick, pollDelay); };
  const wake = () => { clearTimeout(pollTimer); tick(); };
  window.addEventListener("gamepadconnected", wake);
  window.addEventListener("gamepaddisconnected", wake);
  controllerSelect.addEventListener("change", wake);
  document.addEventListener("visibilitychange", wake);
  tick();
}

function syncInput(source) {
  combinedPressed = mergePressedSets(keyboardPressed, touchPressed, gamepadPressed, mousePressed);
  const analog = { ...gamepadInputState, ...mouseInputState, ...touchInputState };
  // Retained absolute aim belongs to the device that most recently moved it.
  // A previous screen tap must not pin the cursor over later mouse/pad input.
  const pointer = { mouse: mouseInputState, touch: touchInputState, gamepad: gamepadInputState }[pointerSource];
  if (pointerSource) {
    analog.cStickX = pointer?.cStickX ?? 128;
    analog.cStickY = pointer?.cStickY ?? 128;
  }
  const digitalPressed = mergePressedSets(keyboardPressed, touchPressed, mousePressed);
  host.setInputState(inputStateFromPressed(combinedPressed, analog, digitalPressed));
  elements.inputSource.textContent = source;

  for (const chip of elements.controlGrid.children) {
    chip.classList.toggle("active", combinedPressed.has(chip.dataset.control));
  }
}

function renderControlGrid() {
  const fragment = document.createDocumentFragment();

  for (const label of CONTROL_LABELS) {
    const chip = document.createElement("span");
    chip.className = "control-chip";
    chip.dataset.control = label;
    chip.textContent = formatControlLabel(label);
    fragment.append(chip);
  }

  elements.controlGrid.append(fragment);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatBytesMaybe(bytes) {
  return Number.isFinite(bytes) && bytes >= 0 ? formatBytes(bytes) : "";
}

function formatHex(value) {
  return Number.isFinite(value) && value >= 0 ? `0x${Math.trunc(value).toString(16).toUpperCase()}` : "";
}

function formatLargeInteger(value) {
  return Number.isFinite(value) ? Math.trunc(value).toLocaleString("en-US") : "0";
}

function formatMetricNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }

  return numeric >= 10 ? String(Math.round(numeric)) : numeric.toFixed(1);
}

function formatPresentationLag(info) {
  const frameLag = Math.max(0, Number(info.presentationFrameLag) || 0);
  return `${frameLag.toFixed(0)}f`;
}

function parseJitState(info) {
  const helperStats = info.ppcWasmHelperStats || "";
  const match = /(?:^|\s)jit:([a-z0-9_-]+)/i.exec(helperStats);
  if (match) {
    return match[1] === "on" ? "JIT on" : `JIT ${match[1]}`;
  }

  if ((info.ppcWasmBlockCompileCount || 0) > 0 || (info.ppcWasmBlockRunCount || 0) > 0) {
    return "JIT active";
  }

  return currentSettings.wasmjit === "1" ? "JIT armed" : "JIT off";
}

function parsePresentationResolution(info) {
  const helperStats = info.ppcWasmHelperStats || "";
  const match = /present:(\d+x\d+)/i.exec(helperStats);
  if (match) {
    return match[1];
  }

  return `${elements.screen.width}x${elements.screen.height}`;
}

function formatOffsetSize(offset, size) {
  const parts = [formatHex(offset), formatBytesMaybe(size)].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function formatImageSizes(rawSize, dataSize) {
  const raw = formatBytesMaybe(rawSize);
  const data = formatBytesMaybe(dataSize);
  return raw && data ? `${raw} / ${data}` : raw || data || "-";
}

async function runSmokeScenario() {
  const scenario = new URLSearchParams(window.location.search).get("smoke");
  if (scenario !== "melee") {
    return;
  }

  const header = new Uint8Array(0x3000);
  header.set(new TextEncoder().encode("GALE01"), 0);
  header.set([0xc2, 0x33, 0x9f, 0x3d], 0x1c);
  header.set(new TextEncoder().encode("Super Smash Bros. Melee"), 0x20);
  header.set([0x00, 0x00, 0x00, 0x01], 0x458);
  header.set(new TextEncoder().encode("2026/05/05"), 0x2440);
  writeU32BE(header, 0x420, 0x1000);
  writeU32BE(header, 0x424, 0x2800);
  writeU32BE(header, 0x428, 0x24);
  writeU32BE(header, 0x1000, 0x100);
  writeU32BE(header, 0x1048, 0x80003100);
  writeU32BE(header, 0x1090, 0x40);
  writeU32BE(header, 0x10d8, 0x80400000);
  writeU32BE(header, 0x10dc, 0x1000);
  writeU32BE(header, 0x10e0, 0x80003100);
  writeU32BE(header, 0x2454, 0x20);
  writeU32BE(header, 0x2458, 0x10);
  writeU32BE(header, 0x2800, 0x01000000);
  writeU32BE(header, 0x2804, 0);
  writeU32BE(header, 0x2808, 2);
  writeU32BE(header, 0x280c, 0);
  writeU32BE(header, 0x2810, 0x2900);
  writeU32BE(header, 0x2814, 4);
  header.set(new TextEncoder().encode("opening.bnr"), 0x2818);
  header.set(new TextEncoder().encode("BNR1"), 0x2900);

  const file = new File([header], "Super Smash Bros Melee.iso", {
    type: "application/octet-stream"
  });
  await mountFile(file, { progress: false });
  window.__wasmDolphinSmoke = {
    mode: host.mode,
    game: host.game
  };
}

function writeU32BE(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

initLibrary({ mountFile, bootProgress }).then(() => import("./widget-layout.js")).catch(error => console.error("Library:", error));

// Release runtime packages carry their complete matching source archive.
fetch(new URL("../backend-runtime.json",import.meta.url)).then(response=>response.json()).then(manifest=>{
 const link=document.querySelector("#sourceDownload");
 if(link && manifest.sourceDownload && manifest.files.some(file=>file.path===manifest.sourceDownload)){
  link.href=new URL(manifest.sourceDownload,new URL("../",import.meta.url));link.hidden=false;
 }
}).catch(()=>{});
