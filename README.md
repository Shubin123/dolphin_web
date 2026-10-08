# Dolphin Web

Dolphin is a GameCube / Wii emulator, allowing you to play games for these two platforms on PC with improvements.

A browser frontend for Shubin123, using the library and controls patterns from [Azahar Web](https://shubin123.github.io/azahar_web/), with an actual Dolphin Emscripten core.

**Play:** https://shubin123.github.io/dolphin_web/

## Run locally

```sh
npm start
```

Open the printed localhost URL in desktop Chrome. Use **Open disc** for immediate play or **Add games** to copy images into the persistent browser library. Search, region filters, sorting, pagination, Play and Remove operate on your library. Use the transport for pause/reset, mute, fullscreen and state import/export; the settings panel provides renderer and speed controls. Keyboard and gamepad input mappings are displayed in the panel.

Persistent game images use disk-backed Origin Private File System storage, streamed without first loading the whole image into JavaScript memory. Browser storage needs space for each imported image. Storage can be cleared by the browser. When persistent storage is unavailable, the library retains files for the current session.

## Sibling source repository

```
dolphin_emscripten/   C++ wrapper, locked Dolphin patches and build tooling
  vendor/dolphin/     Materialized pinned upstream source
  CMakeLists.txt     dolphin_web_bundle and dolphin_web_assets targets
dolphin_web/         Public web distribution
  web/               Self-contained Pages deployment, including WASM
  tests/             Distribution tests
```

```sh
node ../dolphin_emscripten/tools/export-web.mjs web
```

The backend follows Azahar's explicit sibling output-directory pattern using `DOLPHIN_WEB_ASSET_DIR`. See [the source repository](https://github.com/Shubin123/dolphin_emscripten) and [build guide](web/docs/repro-build.md). The shipped WASM is an inherited prebuilt core; its original build record and source locks are retained unchanged.

GitHub Actions deploys `web/` to Pages on `main` pushes. A same-origin service worker supplies isolation headers needed for SharedArrayBuffer; the first visit may reload once. HTTPS and service-worker support are required.

## Source and license

Based on [dougchansan/wasm-dolphin](https://github.com/dougchansan/wasm-dolphin), which compiles [Dolphin](https://github.com/dolphin-emu/dolphin). GPL-2.0-or-later. Original attribution, licenses and documentation remain in [web/README.upstream.md](web/README.upstream.md). This project is independent of the Dolphin Emulator Project.

The public `web/` directory includes the C ABI wrapper, build scripts, locked upstream SHA, patch series and provenance so the compiled core's source remains accessible even if the sibling development repo is private. The corresponding-source release archive contains the patched upstream C++ tree and build inputs. No games or commercial save states are included.

## Current limits

This is an experimental port. Performance and rendering vary by game/browser. Software rendering is the default; hardware WebGPU is experimental. Wii support is partial and Wii Remote input is unavailable. The library uses local images; no remote game catalog is bundled. Actual game compatibility requires testing with your own images.

## Verification

```sh
npm run smoke      # WASM validation and build SHA-256
npm test           # Library filtering tests
npm ci
npm run test:browser   # Desktop Chrome; CHROME_PATH overrides executable
```

The browser test serves a Pages-style subpath without isolation headers. It checks the service worker, persistent library import/search/replay/removal, and mounts a generated metadata-only disc through the real Dolphin WASM. It does not exercise gameplay.

[Download the complete corresponding source](https://github.com/Shubin123/dolphin_web/releases/tag/v0.1.0).
