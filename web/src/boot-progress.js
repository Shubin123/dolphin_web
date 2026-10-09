// GPL-2.0-or-later. On-screen loading bar from disc selection to the first
// visible game frame. The core reports no fine-grained boot progress, so
// stages with unknown duration ease toward their ceiling and only the
// download stage reports exact bytes. Completion is real: the bar finishes
// when the booted core presents its first visually changing frame.
const PLAN = {
  local: { read: [0, 8], core: [8, 50], boot: [50, 99] },
  download: { download: [0, 70], read: [70, 73], core: [73, 85], boot: [85, 99] },
};
const LABELS = {
  download: 'Downloading disc image',
  read: 'Reading cached disc',
  core: 'Starting Dolphin core',
  boot: 'Booting game',
};
// Time constants for the eased stages, in seconds. A stage reaches ~63% of
// its span after one constant and never reaches its ceiling by time alone.
const TAU = { read: 0.6, core: 2.5, boot: 6 };
const SLOW_BOOT_SECONDS = 30;
const duration = seconds => seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.ceil(seconds % 3600 / 60)}m`
  : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s` : `${Math.ceil(seconds)}s`;
const bytes = size => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`;

export function createBootProgress(viewport) {
  const root = document.createElement('div');
  root.className = 'boot-progress';
  root.hidden = true;
  root.innerHTML = `<div class="boot-progress-card">
    <p class="boot-progress-title"></p>
    <div class="boot-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Game loading progress"><div class="boot-progress-fill"></div></div>
    <div class="boot-progress-row"><span class="boot-progress-stage" role="status"></span><span class="boot-progress-percent">0%</span></div>
    <p class="boot-progress-detail"></p>
    <button class="boot-progress-dismiss" type="button" hidden>Dismiss</button></div>`;
  viewport.append(root);
  const $ = selector => root.querySelector(selector);
  const track = $('.boot-progress-track');
  $('.boot-progress-dismiss').onclick = () => hide();

  let plan = PLAN.local;
  let stage = null;
  let stageStarted = 0;
  let started = 0;
  let fraction = null;
  let detail = '';
  let shown = 0;
  let timer = 0;
  let fadeTimer = 0;

  function render() {
    if (!stage) return;
    const [from, to] = plan[stage] || [0, 99];
    const elapsed = (performance.now() - stageStarted) / 1000;
    const share = fraction ?? (TAU[stage] ? 1 - Math.exp(-elapsed / TAU[stage]) : 0);
    // Never move backwards, even when a later stage starts below an eased value.
    shown = Math.max(shown, from + (to - from) * Math.min(1, share));
    $('.boot-progress-fill').style.width = `${shown}%`;
    // Large downloads move slowly; a decimal shows they are not stuck.
    $('.boot-progress-percent').textContent = stage === 'download' ? `${shown.toFixed(1)}%` : `${Math.floor(shown)}%`;
    track.setAttribute('aria-valuenow', String(Math.floor(shown)));
    const total = Math.floor((performance.now() - started) / 1000);
    const slow = stage === 'boot' && elapsed > SLOW_BOOT_SECONDS
      ? ' · Still waiting for the first picture. Some discs show a black screen for a while.' : '';
    $('.boot-progress-detail').textContent = `${detail || `${total}s elapsed`}${slow}`;
  }
  function hide() {
    clearInterval(timer); clearTimeout(fadeTimer);
    timer = 0; stage = null;
    root.hidden = true;
    root.classList.remove('done', 'failed');
  }
  function enter(name) {
    stage = name; stageStarted = performance.now(); fraction = null; detail = '';
    $('.boot-progress-stage').textContent = LABELS[name];
    render();
  }
  const api = {
    get active() { return Boolean(stage); },
    begin(title, { download = false } = {}) {
      hide();
      plan = download ? PLAN.download : PLAN.local;
      started = performance.now(); shown = 0;
      $('.boot-progress-title').textContent = title;
      $('.boot-progress-dismiss').hidden = true;
      root.hidden = false;
      enter(download ? 'download' : 'read');
      timer = setInterval(render, 100);
    },
    stage(name) { if (stage) enter(name); },
    download(loaded, total, speed) {
      if (stage !== 'download') return;
      fraction = total ? loaded / total : 0;
      detail = `${bytes(loaded)} / ${bytes(total)}${speed ? ` · ${bytes(speed)}/s · ~${duration((total - loaded) / speed)} remaining` : ''}`;
      render();
    },
    // Called for every frame summary. Only a booted core's visible output
    // completes the bar; the demo core's frames before mount do not count.
    frame(info) {
      if (stage !== 'boot' || info?.mode !== 'dolphin') return;
      detail = `Emulated frame ${info.frame || 0} · ${Math.floor((performance.now() - started) / 1000)}s elapsed`;
      if (Number(info.visualChangeFps) > 0) api.done();
    },
    done() {
      if (!stage) return;
      clearInterval(timer); timer = 0;
      stage = null;
      $('.boot-progress-fill').style.width = '100%';
      $('.boot-progress-percent').textContent = '100%';
      $('.boot-progress-stage').textContent = 'Ready';
      track.setAttribute('aria-valuenow', '100');
      root.classList.add('done');
      fadeTimer = setTimeout(hide, 450);
    },
    fail(message) {
      if (!stage) return;
      clearInterval(timer); timer = 0; stage = null;
      root.classList.add('failed');
      $('.boot-progress-stage').textContent = 'Unable to start the game';
      $('.boot-progress-detail').textContent = message;
      $('.boot-progress-dismiss').hidden = false;
    },
    cancel: hide,
  };
  return api;
}
