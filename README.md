# Dolphin Web

Dolphin is a GameCube / Wii emulator, allowing you to play games for these two platforms on PC with improvements.

A browser frontend for Shubin123, using the library and controls patterns from [Azahar Web](https://shubin123.github.io/azahar_web/), with an actual Dolphin Emscripten core.

**Play:** https://shubin123.github.io/dolphin_web/

## Run locally

```sh
npm start
```

Open the printed localhost URL in desktop Chrome. The library opens on [Internet Archive’s Wii ISO catalog](https://archive.org/download/Wii_ISO). Use **Download** to save an original image to your device, **Cache** to store it in this browser, or **Play** to download, cache, and start it. **Ready to play** lists cached games with Play, Save file, and Remove. Play reuses cached images after a page visit without fetching the disc again.

Use **Open disc** for immediate local play or **Add games** to copy your images into the persistent browser library. Select **My cached games** to browse only local images. Search, region filters, sorting, pagination, Play and Remove operate on your library. Use the transport for pause/reset, mute, fullscreen and state import/export; the settings panel provides renderer and speed controls. Keyboard and gamepad input mappings are displayed in the panel.

To save game progress, use **Save state** or choose **Save** beside one of the four slots in **Save states**. Saving again replaces that slot. Slots persist in this browser per game and emulator build: reopen the same game, then choose **Load** to resume. The transport and fullscreen Save/Load buttons use the selected slot. **Download .sav** creates a backup; **Upload .sav** restores a compatible file while the matching game is open. Clearing browser storage removes local slots, and a different core build may require a new save.

Mouse hover over the game picture moves the Wii pointer by default, including fullscreen. Left/right/middle clicks send A/B/−. Leaving the picture or switching away releases mouse input. Choose **Main stick** or **Disabled** under **Keyboard, mouse & Bluetooth controller** to change this behavior.

Persistent game images use disk-backed Origin Private File System storage, streamed without first loading the whole image into JavaScript memory. Browser storage needs space for each imported image. Storage can be cleared by the browser. When persistent storage is unavailable, the library retains files for the current session.

## Sibling source repository

```
dolphin_emscripten/   C++ wrapper, locked Dolphin patches and build tooling
  vendor/dolphin/     Materialized pinned upstream source
  CMakeLists.txt     dolphin_web_bundle and dolphin_web_assets targets
dolphin_web/         Public web distribution
  app/               Owned frontend UI source
  web/               Generated Pages deployment, including packaged WASM
  tests/             Distribution tests
```

```sh
node ../dolphin_emscripten/tools/export-web.mjs web
```

The backend follows Azahar's explicit sibling output-directory pattern using `DOLPHIN_WEB_ASSET_DIR`. See [backend development setup](https://github.com/Shubin123/dolphin_emscripten/blob/main/docs/development.md). The WASM is rebuilt from the backend source. `npm run build` builds this repository’s UI without overwriting engine assets; `npm run check` verifies both inventories. Backend sync invokes the frontend build automatically. All Pages builds import the successful runtime artifact for current backend main; configure `BACKEND_READ_TOKEN` for private backend access. Workflows must be committed and pushed to take effect.

GitHub Actions deploys `web/` to Pages on `main` pushes. A same-origin service worker supplies isolation headers needed for SharedArrayBuffer; the first visit may reload once. HTTPS and service-worker support are required.

## Source and license

Based on [dougchansan/wasm-dolphin](https://github.com/dougchansan/wasm-dolphin), which compiles [Dolphin](https://github.com/dolphin-emu/dolphin). GPL-2.0-or-later. Original attribution and documentation remain in [README.upstream.md](README.upstream.md); the deployed runtime includes LICENSE. This project is independent of the Dolphin Emulator Project.

The backend owns C++ source and build scripts. The runtime contains artifact provenance and license information; distribute the matching corresponding-source archive alongside releases, especially if the backend is private. The corresponding-source release archive contains the patched upstream C++ tree and build inputs. No games or commercial save states are included.

## Current limits

This is an experimental port. Performance and rendering vary by game/browser. Software rendering is the default; hardware WebGPU is experimental. The native bridge supplies an emulated Wii Remote and Nunchuk; Wii compatibility remains partial. The archive catalog contains 110 ISO entries in the bundled snapshot and refreshes from Archive metadata. Remote files use Internet Archive’s CORS-enabled stream endpoint (`archive.org/cors/Wii_ISO/`); source links and device downloads use the requested `archive.org/download/Wii_ISO` location. Catalog metadata is cached with a bundled fallback; game images are streamed directly into browser storage. Progress includes percentage, bytes, speed and ETA, and Cancel discards incomplete files. File-size mismatches and storage failures leave no playable cache entry. Games require enough browser storage, and the app itself must be loaded to play cached images. Wii compatibility still depends on the emulator’s partial Wii support.

## Verification

```sh
npm run smoke      # WASM validation and build SHA-256
npm test           # Library filtering tests
npm ci
npm run test:e2e    # Library flow + real PowerPC guest boot/pause/resume
npm run test:live   # Live Archive metadata + first 256 ISO bytes
# CHROME_PATH overrides the desktop Chrome executable.
```

The browser test serves a Pages-style subpath without isolation headers. It checks the service worker, persistent local library, archive catalog, download/cancel/error cleanup, Save file, automatic download-and-play and cached replay, and mounts a generated metadata-only disc through the real Dolphin WASM. Unit tests also exercise streaming byte counts beyond 4 GiB without buffering the image. A live browser probe verified Archive metadata and the first 256 bytes of an ISO through the CORS endpoint; a full multi-gigabyte download and commercial gameplay were not run. A second E2E test boots an original generated 16 MiB homebrew disc, verifies the PowerPC guest program counter and advancing emulated time, and checks pause/resume. The generated guest has no graphics, so these tests do not establish commercial-game rendering, Wii Remote compatibility, or gameplay performance.

[Download the complete corresponding source](https://github.com/Shubin123/dolphin_web/releases/tag/v0.1.1).

The Pages workflow runs `npm ci`, the WASM smoke and library regression tests, and both browser E2E suites before publishing. Archive tests use generated disc fixtures; the optional live test cancels the stream after reading its header. Test programs and generators are committed under `tests/`; game images are not.

### Input controls

Open **Keyboard, mouse & Bluetooth controller** in the side panel. Click a keyboard binding and press a new key; mappings persist locally and can be reset. Enable **Wii pointer / C-stick** mouse mode to aim by moving over the screen. Aim stays in place after a click; left/right/middle buttons send A/B/− (GameCube A/B/Z). Main stick mouse mode uses hold/drag and centers on release. Screen touches also retain aim after a tap. Losing focus releases controls and aim.

Wii mappings: X/Z = A/B, V/B = 1/2, Enter/C = +/−, H = Home, Q/E = Nunchuk C/Z, WASD = Nunchuk stick, IJKL = pointer. Space shakes the Remote, left Shift shakes the Nunchuk, and numpad 4/6/8/2 tilts the Remote left/right/forward/backward. Touch controls provide buttons, movement, aiming, and shake. Pair USB or Bluetooth standard controllers through your operating system; the left stick moves the Nunchuk and the right stick aims. These are emulated controls; physical Wii Remote sensor input and MotionPlus are not implemented.

### Display upscaling

**Display upscaling** applies immediately and remembers your choice: **Current default**, **Smooth**, or **Crisp pixels**. The default renderer, resolution and filtering remain unchanged. Scaling uses the browser's existing canvas composition, including transferred OffscreenCanvas surfaces and fullscreen; it adds no emulator framebuffer, upload, CPU pixel loop or render pass. The backend's WebGPU presenter already uses hardware linear filtering in its existing single blit. This enlarges native output; it does not increase internal rendering detail. No commercial-game FPS improvement is claimed.

### iOS validation

`npm run test:ios` verifies real WASM execution and persistent saves in mobile-emulated WebKit, including the Pages isolation path and native touch inputs. Physical iPhone/iPad performance remains untested; there is no iOS guarantee. See [device validation and memory limits](docs/ios.md).
