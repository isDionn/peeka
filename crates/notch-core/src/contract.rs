//! The command names the UI may call (`ui/src/bridge.ts` `Commands`) and the event names Rust emits. One list each,
//! checked by the tests below: commands against the `generate_handler!` block in `crates/notch-app/src/app.rs`, events
//! against every `emit("...")` in `crates/notch-app/src/`, both against `ui/src/commands.generated.ts` (the UI's tsc checks
//! that file against `Commands`), and for duplicates. `cargo test --lib` runs it, so the bin crate is checked even
//! though the bin itself is not tested.

pub const COMMANDS: &[&str] = &[
    "get_monitor",
    "list_windows",
    "get_pins",
    "set_pins",
    "import_taskbar_pins",
    "show_desktop",
    "activate_window",
    "close_window",
    "new_window",
    "launch_app",
    "list_apps",
    "search",
    "open_result",
    "get_status",
    "set_volume",
    "set_brightness",
    "audio_get",
    "set_audio_output",
    "set_mic_muted",
    "audio_sessions",
    "audio_session_set",
    "set_radio",
    "set_dnd",
    "open_windows_settings",
    "open_tray",
    "power",
    "restore_taskbar",
    "quit",
    "demo_restart",
    "get_settings",
    "set_settings",
    "report_hit_rects",
    "taskbar_set_mode",
    "get_media",
    "media_control",
    "list_alerts",
    "dismiss_alert",
    "clear_alerts",
    "open_alert",
    "sysmon_start",
    "sysmon_stop",
    // The music bars follow the speaker's level while shown
    "audio_level_start",
    "audio_level_stop",
    // Wave 3 plugins (names and shapes: ui/src/plugin-api.ts)
    "plugin_surfaces",
    "plugin_action",
    "approval_answer",
    "composer_submit",
    "composer_voice",
    "consent_get",
    "consent_answer",
    "plugin_list",
    "plugin_set_scope",
    "plugin_set_main",
    "plugin_disconnect",
    "plugin_remove",
    "modules_get",
    "modules_set",
    // Wave 4 (names and shapes: ui/src/wave4-api.ts; `lock_release` is extra)
    "lock_state",
    "lock_now",
    "lock_release",
    "clip_visible",
    "clip_list",
    "clip_copy",
    "clip_pin",
    "clip_delete",
    "clip_clear",
    "clip_reveal",
    "clip_share",
    "clip_edit",
    "clip_drag",
    // Peeka Phase C: the copy strip's big preview, open with the default app, onto the shelf
    "clip_open",
    "clip_to_shelf",
    "clip_preview",
    "clip_ocr",
    // Peeka Phase C: "Download finished" (Downloads folder, names and sizes only)
    "download_open",
    "download_show_in_folder",
    "search_index_state",
    "search_open",
    "search_ask",
    // Wave 5 (shapes: ui/src/bridge.ts Wave 5 block)
    "window_preview",
    "share_open",
    "shelf_list",
    "shelf_ask",
    "shelf_add",
    "shelf_open",
    "shelf_pin",
    "shelf_remove",
    "shelf_copy_files",
    "shelf_share",
    "shelf_show_in_folder",
    "shelf_zip",
    "shelf_drag",
    "timer_get",
    "timer_start",
    "timer_control",
    "privacy_get",
    // Wave 6: the read-only tray list behind `open_tray` (PENDING Wave 0 test 4), the Windows notification mirror
    "tray_open",
    "mirror_state",
    "mirror_enable",
    "mirror_disable",
    "mirror_list",
    "mirror_dismiss",
    "mirror_open_app",
    "mirror_ask",
    "notif_copy_code",
    // Fidelity 3 (shapes: ui/src/fidelity-api.ts, fidelity-cards-api.ts, bridge.ts FIDELITY BLOCK)
    "quit_app",
    "open_start_menu",
    "open_calendar",
    "island_hide",
    "island_hidden",
    "tray_icons",
    "recent_files",
    "open_recent",
    "set_start_items",
    "app_show_in_folder",
    "launch_app_admin",
    // Fidelity 3: from the main assistant (notch_core::plugins::host::assistant)
    "assistant_counts",
    "assistant_open",
    "calendar_next",
    "claude_bridge_state",
    "claude_bridge_install",
    "claude_bridge_remove",
    "agent_bridges",
    "agent_bridge_install",
    "agent_bridge_remove",
    "agent_bridge_preview",
    "cc_focus_terminal",
    "cc_diff",
    "cc_diff_open",
    "permission_history",
    "first_connect_get",
    "first_connect_ack",
    "shelf_suggest",
    "shelf_memory",
    "assistant_start",
    // Fidelity 3: Ctrl+Space attachments (fidelity-cards-api.ts)
    "composer_kinds",
    "composer_scan",
    "composer_attach_file",
    // F7: drag the mascot onto a window (its app, title and picture go to the Ctrl+Space box)
    "window_pick",
    // Scope tracking: an elevated window's "Open Task Manager" (`WindowInfo.elevated`)
    "open_task_manager",
    // Tab order strip <-> island, only while a Notch window holds the focus
    "focus_strip",
    "focus_island",
    // A typing panel (Search, the composer) is open or closed: the focus is taken only meanwhile and given back
    "typing_focus",
    // F8: weekly recap (counts only, `notch_core::recap`)
    "recap_get",
    "recap_ack",
    "recap_copy_image",
    // The Modules card's Claude chat through the owner's Claude Code CLI (`notch_core::claude_chat`)
    "claude_chat_state",
    "claude_chat_send",
    "claude_chat_stop",
    "claude_chat_new",
    // Ctrl+Alt+Shift+D / Settings > About: one local text file for bug reports (`notch_core::diagnostics`)
    "save_diagnostics",
    "diagnostics_open_folder",
    // Assistant slots: one page -> main assistant request (brand `page_requests`), the reply comes as `assistant_reply`
    "assistant_request",
    // Long-press pickers on the Wi-Fi / Bluetooth tiles (`notch_win::wifi`, `notch_win::bluetooth`)
    "wifi_networks",
    "wifi_connect",
    "bt_devices",
    "bt_set",
];

/// Every event Rust emits to the pages. Payloads: see the header of `crates/notch-app/src/app.rs`.
pub const EVENTS: &[&str] = &[
    "windows_changed",
    "pins_changed",
    "shortcut",
    "status_changed",
    "settings_changed",
    "notch://fullscreen",
    "notch://notice",
    "media_changed",
    "alerts_changed",
    "sysmon_tick",
    "audio_level",
    "volume_osd",
    "plugins_changed",
    "consent_changed",
    "plugin_surfaces_changed",
    "composer_event",
    "plugin_stream",
    "lock_changed",
    "clip_changed",
    "bluetooth_connected",
    "music_stopped",
    "download_done",
    "cpu_high",
    "fullscreen_screens",
    "approval_badge",
    "privacy_changed",
    "input_tick",
    "timer_changed",
    "shelf_changed",
    "shelf_drag",
    "notifications_changed",
    "island_hidden_changed",
    "clip_drag_end",
    "first_connect",
    "job_done",
    "assistant_offline",
    "meeting_changed",
    "cc_event",
    "cc_edit",
    "notch://outside_press",
    "notch://island_leave",
    "claude_chat_delta",
    "claude_chat_done",
    "diagnostics_saved",
    "screen_tint",
    "assistant_event",
    "assistant_reply",
];

fn ts_list(out: &mut String, name: &str, items: &[&str]) {
    out.push_str(&format!("export const {name} = [\n"));
    for c in items {
        out.push_str(&format!("  \"{c}\",\n"));
    }
    out.push_str("] as const;\n");
}

/// What `ui/src/commands.generated.ts` must contain, byte for byte.
pub fn generated_ts() -> String {
    let mut out = String::from(
        "// GENERATED from notch-core `contract::COMMANDS` / `EVENTS`; `cargo test -p notch-core` rewrites it\n\
         // (NOTCH_WRITE_TS=1) and fails while it differs. Do not edit by hand.\n",
    );
    ts_list(&mut out, "COMMAND_NAMES", COMMANDS);
    ts_list(&mut out, "EVENT_NAMES", EVENTS);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::path::PathBuf;

    fn notch_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
    }

    #[test]
    fn no_duplicates() {
        assert_eq!(COMMANDS.iter().collect::<BTreeSet<_>>().len(), COMMANDS.len());
        assert_eq!(EVENTS.iter().collect::<BTreeSet<_>>().len(), EVENTS.len());
    }

    #[test]
    fn the_tauri_handler_registers_exactly_these() {
        let app = std::fs::read_to_string(notch_root().join("crates/notch-app/src/app.rs")).unwrap();
        let start = app.find("generate_handler![").expect("generate_handler! in app.rs");
        let block = &app[start..start + app[start..].find(']').unwrap()];
        let registered: BTreeSet<&str> = block
            .split("crate::commands::")
            .skip(1)
            .map(|s| s.split(|c: char| c == ',' || c.is_whitespace()).next().unwrap())
            .collect();
        assert_eq!(registered, COMMANDS.iter().copied().collect::<BTreeSet<_>>());
    }

    #[test]
    fn the_app_emits_exactly_these_events() {
        let mut emitted = BTreeSet::new();
        for entry in std::fs::read_dir(notch_root().join("crates/notch-app/src")).unwrap() {
            let src = std::fs::read_to_string(entry.unwrap().path()).unwrap();
            for part in src.split("emit(\"").skip(1) {
                emitted.insert(part.split('"').next().unwrap().to_string());
            }
        }
        assert_eq!(emitted, EVENTS.iter().map(|e| e.to_string()).collect::<BTreeSet<_>>());
    }

    #[test]
    fn the_ui_list_matches() {
        let path = notch_root().join("ui/src/commands.generated.ts");
        let want = generated_ts();
        if std::env::var_os("NOTCH_WRITE_TS").is_some() {
            std::fs::write(&path, &want).unwrap();
        }
        let got = std::fs::read_to_string(&path).unwrap_or_default().replace("\r\n", "\n");
        assert_eq!(got, want, "run `NOTCH_WRITE_TS=1 cargo test -p notch-core contract` to regenerate");
    }
}
