# Dolphin Web tests

Run from the public `dolphin_web` repository:

```sh
npm ci
npm run smoke
npm run test:regression
npm run test:e2e
npm run test:live
```

Set `CHROME_PATH` for a Chrome executable outside the default macOS location. The Pages workflow uses `/usr/bin/google-chrome` and runs smoke, regression, and both E2E suites before deployment.

- `artifacts.mjs`: validates the real WASM and its recorded SHA-256/build identity.
- `library*.test.mjs`: catalog normalization, region filtering, CORS stream selection, bounded streaming with byte counts beyond 4 GiB, quota failures, cancellation, truncated transfers and catalog-cache fallback.
- `browser.mjs`: serves a Pages-style subpath without isolation headers; verifies the service worker, local import/persistence/search, remote catalog, download progress/cancellation, incomplete-transfer cleanup, disk-backed caching, Save file bytes, automatic download-and-play and cache replay without another image request. Archive data and discs are generated fixtures.
- `core-browser.mjs` and `helpers/homebrew-disc.mjs`: boot the actual Dolphin core with an original generated 16 MiB GameCube disc. Verify the executing PowerPC program counter, advancing emulated time, and pause/resume. The generated guest contains no Nintendo or commercial game code and draws no graphics.
- `live-archive.mjs`: checks the live Pages origin, real Archive metadata, and the first 256 bytes of a Wii ISO through Internet Archive's CORS endpoint, then cancels the stream.

## Verified on 2026-10-08

- Web smoke and 13 web regression tests: passed.
- Both local browser E2E suites: passed.
- Source sibling full regression suite: 992 passed, 2 skipped, 0 failed (994 total).
- Live Archive probe: 110 ISO entries, metadata HTTP 200, stream HTTP 200, 256 readable bytes with Wii magic `5d1c9ea3`.
- Shipped core SHA-256: `d7395b3a94080f5b7d08a0522f59096007419d117b7b0eb868246429adee6f5c`.

These checks establish the library flow and actual guest CPU execution. They do not qualify commercial-game graphics, Wii Remote input, or sustained gameplay performance. No full multi-gigabyte commercial image is downloaded by the test suite.

Input E2E checks cover keyboard press/release, search-field typing isolation, persisted remapping, blur cleanup, mouse analog movement and centering, simulated Bluetooth controller buttons/axes, device detection, disabling and disconnection. Actual Bluetooth pairing and physical hardware are not automated.
