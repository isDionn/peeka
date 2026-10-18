# Contributing to Peeka

Issues and pull requests are welcome. Keep changes small and focused; open an issue or a Discussion first for anything large.

## Build and run

Prerequisites: Windows 10/11 with WebView2, Rust stable (MSVC), Node.js and pnpm.

```powershell
cd ui
pnpm install --frozen-lockfile
pnpm dev                       # serves the UI on http://127.1.2.7:5174
# in a second terminal, from the repo root:
cargo run -p notch-app         # a debug build loads the dev URL above
```

Release build (embeds `ui/dist` into the exe): `pnpm build` in `ui/`, then
`cargo build --release -p notch-app --features tauri/custom-protocol` → `target/release/peeka.exe`.

## Tests

From the repo root:

```powershell
cargo test -p notch-core --lib
cargo test -p notch-win --lib
cargo check -p notch-app
```

In `ui/`:

```powershell
npx tsc --noEmit
pnpm test        # vitest
pnpm e2e         # Playwright against a headless Chromium; run `npx playwright install chromium` once
```

CI runs everything above except `pnpm e2e`, so please run it locally for UI changes.

## UX rules

- Nothing moves under the cursor after a click: the element you clicked, and its neighbours, stay where they were.
- Components of the same kind have the same size (buttons, rows, chips, cards).
- No dead ends: every state has a way back or forward.
- Never use `prefers-reduced-motion`.
- In lock and presentation mode, show generic labels only, never content (titles, names, clipboard text, notifications).

## Mascot artwork

The ghost mascot and its artwork are **not** MIT. Do not copy, modify or redistribute it outside unmodified Peeka builds, and do not add new mascot art to a PR. Forks must replace it. See [`docs/MASCOT-LICENSE.md`](../docs/MASCOT-LICENSE.md) for the covered files.

## Commits

Write commit messages, code comments and PR descriptions in English.
