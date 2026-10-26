# Extensions (assistant slots)

A copy of Peeka can plug its own assistant UI into a few fixed places without changing Peeka's files. Peeka's own repo
ships this folder with only this README: every slot is empty, and Peeka looks and behaves exactly as without slots.

## How an extension is found

Put one folder here, `ui/src/ext/<name>/index.tsx`, whose default export is a `PeekaExtension` (`ui/src/ext.ts`). The
build picks it up by itself (`import.meta.glob`); `tsc` and vitest already cover `src/**`, so its own `__tests__` run
too. At most one extension: a second one stops the page at start. Tests register a sample with `setExtForTest`.

| Slot | Contract (`ext.ts`) | Peeka owns |
|---|---|---|
| Y1 strip button | `StripButton: ComponentType<{surfaces, open, onOpen}>` | first item of the strip's right group (primary monitor); `onOpen` focuses the island and sends `ext-go {}`; `open` comes from the island (`ext-open`) |
| Y2 card | `card: {Card, compactWidth, full?: {width, height}, takesAsk?}`; `Card` gets `{size, setSize, target, clearTarget, onClose, surfaces, events, request}` | locked: the lock card stands in; closing resets to compact; `ext-go {full: true}` opens full, every other way compact; the full width is clamped to the island window; Music or Clipboard opened over it (`{t: "card", view}`) tucks it and shows "Back to {label}"; text focus counts as asking; no Modules button; `takesAsk`: Ctrl+Space, the "ask" message and the asleep mascot / center click open it instead of the composer |
| Y3 Ctrl+K | `search: {commands?, groups?}` | commands match locally on "{label} {command}"; groups are asked (query ≥ 2 characters, 200 ms after the last key, cut to 200 characters, at most 5 rows each) only while `surfaces.private` is false, else one line says search is off; order: timer, extension commands, Peeka's results, extension groups, "ask the assistant" |
| Y4 data path | `request(method, params)`, `events`, `surfaces.assistantState` | `lib/assistant.ts`: `request` (rejects with `denied` / `not_connected` / `invalid`, the reply's numeric code, or `timeout` after 10 s), `useAssistantList`, `useAssistantEvents` (≤ 200). Rust: docs/plugin-api.md §11 / §14 |
| Y5 privacy gate | read `surfaces.private`, never compute it | `crates/notch-app/src/privacy.rs::closed`: locked, presenting / busy, or the screen shared; nothing of the slot data reaches the page while closed |
| Y6 preview | `preview: {answer?, states?}` | `preview.html?state=<key>` runs `states[key](fakeBridge)`; `answer` is the fake main assistant (`fakeBridge.setAnswer`; none = `invalid`) |

Also exported for extension cards: `GuardBtn` and `answer` (`components/Plugin.tsx`), `Turn.at` (`hooks.ts`).

## Brand file (Y7, build time)

`brand/peeka.json`, or the path in `NOTCH_BRAND` (relative to the repo root). Read by `crates/notch-core/build.rs`
(Rust consts in `notch_core::brand`), `crates/notch-app/build.rs` (the exe manifest's mirror package),
`ui/vite.config.ts` (`ui/src/brand.ts`) and `crates/notch-app/identity/*.ps1` (`-Brand`). Peeka's file holds today's
values; a test holds each one.

| Field | Peeka | Used for |
|---|---|---|
| `product_name` | `Peeka` | window titles, own-notification filter, reserved plugin names |
| `code_name` | `notch` | `%LOCALAPPDATA%\<code_name>`, pipes `\\.\pipe\<code_name>-<SID>` and `<code_name>-cc-<SID>`, Run value, identity stage folder |
| `data_dir_env` | `NOTCH_DATA_DIR` | data folder override |
| `exe_name` | `peeka` | diagnostics file, `.bak-` / `.tmp-` suffixes, Copilot `hooks/<exe>.json`, Gemini hook name, identity scripts |
| `hook_arg` | `--cc-hook` | the agent hook argument |
| `mirror` | `Notch.Mirror`, `CN=Notch` | notification mirror package (exe manifest, AppxManifest staging) |
| `updates_url` | the GitHub releases page | About › Updates; `null` = no button, not in the allowed links |
| `island_max` | `[760, 620]` | island window size in CSS px (still clamped to the monitor) |
| `page_requests` | `[]` | names the page may send as `page.request`; empty = no request path |
| `start_key_hook` | `true` | Win / Ctrl+Esc keyboard hook for Peeka's Start |
| `hide_taskbar` | `true` | hiding the Windows taskbar (`false`: never touched, the Start key stays with Windows) |
| `reserve_appbar` | `true` | reserving the top work area for the strip |

The Tauri side (`productName`, `mainBinaryName`, `identifier`, `bundle.publisher`) comes from a second file passed with
`tauri build --config <file>`: the CLI merges it into `tauri.conf.json` (also for `tauri-build` at compile time) and
renames the built exe to `mainBinaryName` before bundling, so the NSIS installer uses that name. A plain
`cargo build` keeps the Cargo bin name (`peeka.exe`).
