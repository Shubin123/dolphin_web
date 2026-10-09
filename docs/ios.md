# iOS compatibility and device validation

This port is experimental. A passing desktop WebKit test does not guarantee
performance, memory availability, audio quality, storage retention, or long
sessions on an iPhone or iPad. No physical iOS device or simulator was available
for the October 9, 2026 checks. Do not label a device supported until it passes
the matrix below.

## Automated compatibility coverage

```sh
npm ci
npm run build
npx playwright install webkit
npm run test:ios
```

The test uses an iPhone 13 viewport and touchscreen emulation in desktop WebKit.
It serves without COOP/COEP headers, as GitHub Pages does, and verifies service
worker isolation, shared WASM memory, a real Dolphin boot, advancing PowerPC
execution, default presenter initialization, portrait canvas bounds, landscape
control availability, native touch buttons, multi-pointer ownership, brief taps,
Nunchuk C, movement and pointer axes, Wii Home, background releases, and native
save restoration from IndexedDB and cached-disc replay across a page reload,
including the dedicated-worker OPFS writer used when Safari lacks
`FileSystemFileHandle.createWritable()`. The original synthetic
guest contains no graphics or commercial game code. These are compatibility
checks, not game FPS measurements or actual iOS tests. Pages CI runs the suite
before deployment.

Touch controls provide Move and Aim sticks, A/B, Wii 1/2, Nunchuk C/Z, plus,
minus, Home and D-pad. Touching the screen aims the Wii pointer and presses A.
Full motion simulation is not implemented. Keyboard and gamepad input remain
available. Software rendering is the default; its presenter falls back from
WebGPU to WebGL and then Canvas 2D when unavailable. Use `?presenter=2d` to
explicitly select the verified Canvas path.

## Device acceptance matrix

Record exact model, iOS/Safari version, core SHA-256, renderer, presentation
scale and game revision. Test both portrait and landscape on the hosted build.

1. Open the HTTPS site in Safari and confirm startup without an isolation error.
2. Boot the owned cached City Folk image; verify touch input actually changes the
   game, including movement, menu selection, pointing and Home/Nunchuk controls.
3. Enter a playable town. Collect sustained core FPS, presented FPS and game
   speed for at least five minutes after JIT warmup. Review frame captures.
4. Save, continue playing, restore, reload Safari, select the same cached game,
   and restore again. Match guest checkpoint and reviewed framebuffer.
5. Repeat multi-touch holds, short taps, rotations, app switches, interruption
   of audio, and returning from the background. No stuck buttons are acceptable.
6. Run a 30-minute session and verify no tab termination, storage quota error or
   excessive thermal slowdown. Test low-power mode separately.

The current compiled runtime reserves a fixed 1.5 GiB shared WASM heap and a
16-worker pthread pool. Browser addressability does not establish that a device
can afford this process. A smaller-memory runtime requires a separately built,
ABI-matched core; query parameters cannot shrink this heap. Safari can reclaim
browser storage, and full Wii images require several GiB. Export important saves
outside browser storage. None of these constraints have been physically
validated yet.

Relevant platform documentation:
[Safari 15.2 isolation and shared memory](https://webkit.org/blog/12140/new-webkit-features-in-safari-15-2/),
[Safari 26 WebGPU](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).
These are API milestones, not this port's minimum supported iOS versions.
