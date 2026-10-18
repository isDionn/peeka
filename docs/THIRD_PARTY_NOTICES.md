# Third-party notices (Peeka)

External code that was ported or adapted into Peeka is listed here, one line per file. Each file also carries its own source and licence note at the top. Peeka's own licence is MIT (`LICENSE`).

## HeyyCzer/windows-dynamic-island (inspiration only)

Source: https://github.com/HeyyCzer/windows-dynamic-island. Peeka contains no HeyyCzer code. Licence clean-up (2026-10-17): the small adapted files were rewritten in Peeka's own wording; the four large modules (`clip_image`, `clipboard`, and the two `sysmon` modules) were written from scratch from a behaviour specification alone, without looking at the old code, and carry the header `// Peeka — original implementation (MIT).`. The files below carry the note "Inspired by HeyyCzer/windows-dynamic-island (ideas only; no code copied)" in their headers: only ideas (behaviour, product decisions) were taken, no code.

| Peeka file | Idea taken |
|---|---|
| `crates/notch-core/src/alerts.rs` | alert/event model and priority order |
| `crates/notch-core/src/http_alerts.rs` | paths and JSON shape of the local alert API |
| `crates/notch-core/src/sources.rs` | battery thresholds, "devices already connected at startup are not announced" |
| `crates/notch-core/src/media.rs` | extrapolating the playback position forward |
| `crates/notch-core/src/mirror.rs` | notification mirror behaviour |
| `crates/notch-core/src/clip/mod.rs` | a re-copied item moves to the top |
| `crates/notch-win/src/media.rs` | SMTC session selection |
| `crates/notch-win/src/volume.rs` | volume bar on change |
| `crates/notch-win/src/bluetooth.rs` | Bluetooth device monitoring |
| `crates/notch-win/src/notifications.rs` | reading notifications through `UserNotificationListener` |

Note (2026-10-17): `crates/notch-app/identity/AppxManifest.xml` and `crates/notch-app/notch.manifest` follow Microsoft's standard manifest schema; the HeyyCzer note in their comments was removed, and no code was copied.

## Louis-CFM/coucou (MIT)

Source: https://github.com/Louis-CFM/coucou (the Windows version is under `windows/`), commit `ff825663a959faf09310b571c6c8245d7e7cd1ee`, Copyright (c) 2026 Louis Raillé, MIT License. Owner decision 2026-10-16: items 4, 5 and 7 of the CouCou analysis (docs/research/2026-10-16-coucou-analizi.md) may be adapted. The MIT text in short: permission is granted; the copyright notice above and this permission notice must stay in copies; the software is provided "AS IS", without warranty of any kind.

| Peeka file | Source path (coucou) | What was adapted |
|---|---|---|
| `crates/notch-core/src/session_window.rs` | `windows/src-tauri/src/session_window.rs` | walking up the process tree: the Windows list of tree roots, the depth limit (16), the cycle guard, the "nearest ancestor that owns a window" rule, the session id check |
| `crates/notch-win/src/session_window.rs` | `windows/src-tauri/src/platform/windows.rs` (`process_table`, `focus_process_window`) | Toolhelp32 process snapshot; bringing the window to the front uses Peeka's own `Win32Control::focus` |
| `crates/notch-core/src/shortcuts.rs` (`altgr_vk`, `altgr_reason`) | `windows/src-tauri/src/shortcuts.rs` (`is_altgr_like`, `character_vk`, `typed_character`) | treating Ctrl+Alt (without the Windows key) as AltGr, trying only letter and digit keys |
| `crates/notch-win/src/keyboard.rs` | `windows/src-tauri/src/platform/windows.rs` (`ctrl_alt_types`) | asking "which character does this combination type" across the installed keyboard layouts with `GetKeyboardLayoutList` + `MapVirtualKeyExW` + `ToUnicodeEx` (flag 0x4), dead keys included |

## Louis-CFM/coucou (MIT)

Source: https://github.com/Louis-CFM/coucou, Copyright © Louis-CFM, MIT licence (code only; the Mochi character, its name, sounds and drawings belong to the author and were not used). Owner decision 2026-10-16. No code was copied; the behavioural principles and numbers of the mascot engine (`windows/src/mochi/engine.ts`) were adapted to the Peeka ghost (analysis: `docs/research/2026-10-16-coucou-mochi-analizi.md`).

| Peeka file | Source | What was adapted |
|---|---|---|
| `ui/src/mascot/ghost.ts`, `ui/src/mascot/motion.ts` | `windows/src/mochi/engine.ts` | the `busy` gate (the draw loop stops when nothing moves), gaze (`tanh(dx/260)`, `tanh(dy/200)`, `1 − 0.0025^dt` smoothing), error shake (+4, −4, +2.5, 0 / 50-70-70-90 ms), swallow squash, badge transition (90 ms wipe, then 280 ms back-spring after 100 ms), staggered sparks, click-daze thresholds (1.7 s / 3 clicks) |
