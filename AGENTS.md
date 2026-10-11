Frontend source is `app/`; generated website assets are `web/`. Edit UI/display,
controls and library behavior in `app/`, then run `npm run build`. Engine modules
and compiled WASM are owned by the sibling `dolphin_emscripten` and imported by
its `npm run sync:web` / `npm run build:wasm`. Never edit generated engine files
or copy Dolphin/native source into this repository. `backend-runtime.json` and
`frontend-build.json` define disjoint ownership and detect stale assets.

Run `npm run check` and `npm run test:e2e`. The latter verifies actual native
input consumption and guest execution, not only UI callbacks. `CHROME_PATH`
selects Chrome. `web/` is committed and published
as-is; rebuild and commit it with every `app/` or backend runtime change. Pages
only verifies inventories (`tests/artifacts.mjs`) and never builds.
Keep commercial images, states, caches and framebuffer captures local and
ignored. Do not push or deploy without user authorization.
